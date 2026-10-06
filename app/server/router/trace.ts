import { context, SpanStatusCode, trace as otel, type Span, type Tracer as OtelTracer } from '@opentelemetry/api';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BasicTracerProvider, BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { getExecutionContext } from '@databricks/appkit';
import { dbxJson, hostUrl } from './dbx';

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

// The experiment has a Unity Catalog trace location. The MLflow npm client cannot write there (it uploads span data
// to a presigned cloud-storage URL), so spans go to the workspace OTLP endpoint, which writes them to the experiment's
// UC spans table. The table name comes from the experiment tag that MLflow sets when the trace location is linked.
const SPANS_TABLE_TAG = 'mlflow.experiment.databricksTraceSpanStorageTable';
const MAX_ATTR_CHARS = 20_000;

let tracer: OtelTracer | null = null;

/** Idempotent. Tracing stays off (and the app keeps serving) if the experiment or its UC trace location is missing. */
export async function initTracing(): Promise<boolean> {
  if (tracer) return true;
  const experimentId = process.env.MLFLOW_EXPERIMENT_ID;
  if (!experimentId) {
    console.warn('[trace] MLFLOW_EXPERIMENT_ID is not set, tracing disabled');
    return false;
  }
  try {
    const { experiment } = await dbxJson<{ experiment: { tags?: { key: string; value: string }[] } }>(
      `/api/2.0/mlflow/experiments/get?experiment_id=${encodeURIComponent(experimentId)}`
    );
    const table = experiment.tags?.find((t) => t.key === SPANS_TABLE_TAG)?.value;
    if (!table) {
      console.warn(`[trace] experiment ${experimentId} has no UC trace location, tracing disabled`);
      return false;
    }
    const exporter = new OTLPTraceExporter({
      url: `${hostUrl()}/api/2.0/otel/v1/traces`,
      headers: async () => {
        const h = new Headers();
        await getExecutionContext().client.config.authenticate(h);
        return { ...Object.fromEntries(h.entries()), 'X-Databricks-UC-Table-Name': table };
      },
    });
    const provider = new BasicTracerProvider({
      resource: resourceFromAttributes({ 'service.name': process.env.DATABRICKS_APP_NAME ?? 'jpai-chatbot' }),
      spanProcessors: [new BatchSpanProcessor(exporter)],
    });
    tracer = provider.getTracer('jpai-router');
    console.log(`[trace] exporting spans to ${table}`);
  } catch (err) {
    console.warn('[trace] init failed, tracing disabled:', (err as Error).message);
  }
  return tracer !== null;
}

export function tracingEnabled(): boolean {
  return tracer !== null;
}

function json(value: unknown): string {
  try {
    const s = JSON.stringify(value) ?? 'null';
    return s.length > MAX_ATTR_CHARS ? s.slice(0, MAX_ATTR_CHARS) : s;
  } catch {
    return '"<unserialisable>"';
  }
}

/** Runs fn inside a span. Errors thrown by fn propagate (and mark the span); errors from tracing itself never do. */
async function inSpan<T>(
  t: OtelTracer,
  name: string,
  parent: Span | null,
  inputs: unknown,
  fn: (span: Span | null) => Promise<T>,
  outputs?: (result: T) => unknown
): Promise<T> {
  let span: Span | null = null;
  try {
    const ctx = parent ? otel.setSpan(context.active(), parent) : context.active();
    span = t.startSpan(name, { attributes: { 'mlflow.spanInputs': json(inputs) } }, ctx);
  } catch {
    // tracing must never break a turn
  }
  try {
    const result = await fn(span);
    try {
      span?.setAttribute('mlflow.spanOutputs', json(outputs ? outputs(result) : result));
    } catch {
      // ignore
    }
    return result;
  } catch (error) {
    span?.setStatus({ code: SpanStatusCode.ERROR, message: (error as Error)?.message });
    throw error;
  } finally {
    span?.end();
  }
}

export const otelTracer: Tracer = {
  async turn(meta, fn) {
    const t = tracer;
    if (!t) return noopTracer.turn(meta, fn);
    return inSpan(t, 'route_turn', null, meta, async (root) => {
      root?.setAttributes({ conversation_id: meta.conversation_id, turn_id: meta.turn_id });
      return fn({
        span: (name, inputs, body, outputs) => inSpan(t, name, root, inputs, async () => body(), outputs),
        tag: (tags) => root?.setAttributes(tags),
        traceId: () => root?.spanContext().traceId ?? null,
      });
    });
  },
};
