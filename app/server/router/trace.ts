import * as mlflow from 'mlflow-tracing';

/** What the orchestrator needs from tracing. Every method is safe to call when tracing is off or broken. */
export interface TurnTrace {
  span<T>(name: string, inputs: unknown, fn: () => Promise<T> | T, outputs?: (result: T) => unknown): Promise<T>;
  tag(tags: Record<string, string>): void;
  traceId(): string | null;
}

export interface Tracer {
  turn<T>(
    meta: { conversation_id: string; turn_id: string; message: string },
    fn: (trace: TurnTrace) => Promise<T>
  ): Promise<T>;
}

export const noopTurnTrace: TurnTrace = {
  span: async (_name, _inputs, fn) => fn(),
  tag: () => undefined,
  traceId: () => null,
};

export const noopTracer: Tracer = { turn: (_meta, fn) => fn(noopTurnTrace) };

let enabled = false;

/** Idempotent. Tracing stays off (and the app keeps serving) if the experiment id is missing or init fails. */
export function initTracing(): boolean {
  if (enabled) return true;
  const experimentId = process.env.MLFLOW_EXPERIMENT_ID;
  if (!experimentId) {
    console.warn('[trace] MLFLOW_EXPERIMENT_ID is not set, tracing disabled');
    return false;
  }
  try {
    mlflow.init({ trackingUri: 'databricks', experimentId });
    enabled = true;
  } catch (err) {
    console.warn('[trace] mlflow init failed, tracing disabled:', (err as Error).message);
  }
  return enabled;
}

export function tracingEnabled(): boolean {
  return enabled;
}

/**
 * Runs fn inside an MLflow span. Errors thrown by fn propagate; errors from MLflow itself never do.
 */
async function guardedSpan<T>(
  options: { name: string; inputs?: unknown; spanType?: mlflow.SpanType },
  fn: (span: mlflow.LiveSpan | null) => Promise<T>
): Promise<T> {
  let done = false;
  let result: T | undefined;
  let fnError: { error: unknown } | null = null;
  try {
    return (await mlflow.withSpan(async (span) => {
      try {
        result = await fn(span);
        done = true;
        return result;
      } catch (error) {
        fnError = { error };
        throw error;
      }
    }, options)) as T;
  } catch (err) {
    if (fnError) throw (fnError as { error: unknown }).error;
    if (done) return result as T;
    console.warn('[trace] span failed before running, continuing untraced:', (err as Error).message);
    return fn(null);
  }
}

export const mlflowTracer: Tracer = {
  async turn(meta, fn) {
    if (!enabled) return noopTracer.turn(meta, fn);
    let traceId: string | null = null;
    const trace: TurnTrace = {
      async span(name, inputs, body, outputs) {
        return guardedSpan({ name, inputs }, async (span) => {
          const r = await body();
          try {
            span?.setOutputs(outputs ? outputs(r) : r);
          } catch {
            // tracing must never break a turn
          }
          return r;
        });
      },
      tag(tags) {
        try {
          mlflow.updateCurrentTrace({ tags });
        } catch {
          // ignore
        }
      },
      traceId: () => traceId,
    };
    return guardedSpan({ name: 'route_turn', inputs: meta }, async (root) => {
      traceId = root?.traceId ?? null;
      try {
        mlflow.updateCurrentTrace({
          tags: { conversation_id: meta.conversation_id, turn_id: meta.turn_id },
          requestPreview: meta.message.slice(0, 200),
        });
      } catch {
        // ignore
      }
      return fn(trace);
    });
  },
};
