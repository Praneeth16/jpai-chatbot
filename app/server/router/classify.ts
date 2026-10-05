import { z } from 'zod';
import type { PendingClarification } from '../../shared/api';
import { dbxJson } from './dbx';
import { QUESTIONS } from './questions';
import type { RawClassification } from './types';

export interface ClassifyInput {
  /** The merged message (pending question + reply) when a clarification was pending. */
  message: string;
  recent_turns: { user_message: string; route_id: string }[];
  pending_clarification: PendingClarification | null;
}

export type SystemOnePost = (body: unknown) => Promise<unknown>;

const Noul = z.object({ noul: z.number() });
const Choice = z.object({
  choice: z.string(),
  confidence: z.number(),
  probabilities: z.record(z.string(), z.number()).default({}),
});
const ResponseSchema = z.object({
  model: z.string().optional(),
  answers: z.object({
    adverse_event: Noul,
    injection: Noul,
    has_request: Noul,
    has_conditions: Noul,
    smalltalk: Choice,
    intent: Choice,
  }),
});

const INTENTS = new Set([
  'unanswerable',
  'patient_materials',
  'hcp_materials',
  'drug_info',
  'efficacy_safety',
  'website',
  'contact_az',
  'ambiguous_az',
  'report_ae',
  'out_of_scope',
]);
const SMALLTALK = new Set(['greeting', 'closing', 'about_bot', 'other']);

/**
 * Used when System One is down or returns something unusable. It routes to 2 (contact Medical Information),
 * never crashes, and is marked degraded so the trace and turn_log show it.
 */
export function safeClassification(model: string | null = null): RawClassification {
  return {
    adverse_event: 0,
    injection: 0,
    has_request: 1,
    has_conditions: 0,
    smalltalk: { choice: 'other', confidence: 0 },
    intent: { choice: 'unanswerable', confidence: 1, probabilities: {} },
    model,
    degraded: true,
  };
}

export function parseResponse(raw: unknown): RawClassification {
  const parsed = ResponseSchema.parse(raw);
  const a = parsed.answers;
  if (!INTENTS.has(a.intent.choice) || !SMALLTALK.has(a.smalltalk.choice)) {
    throw new Error(`unexpected choice: ${a.intent.choice} / ${a.smalltalk.choice}`);
  }
  return {
    adverse_event: a.adverse_event.noul,
    injection: a.injection.noul,
    has_request: a.has_request.noul,
    has_conditions: a.has_conditions.noul,
    smalltalk: {
      choice: a.smalltalk.choice as RawClassification['smalltalk']['choice'],
      confidence: a.smalltalk.confidence,
    },
    intent: {
      choice: a.intent.choice as RawClassification['intent']['choice'],
      confidence: a.intent.confidence,
      probabilities: a.intent.probabilities,
    },
    model: parsed.model ?? null,
    degraded: false,
  };
}

const postToGateway: SystemOnePost = (body) =>
  dbxJson('/ai-gateway/typesafe/v1/systemone', { method: 'POST', json: body, timeoutMs: 8_000 });

export function buildRequest(input: ClassifyInput, model: string): unknown {
  return {
    model,
    state: {
      current_message: input.message,
      recent_turns: input.recent_turns,
      pending_clarification: input.pending_clarification,
    },
    questions: QUESTIONS,
  };
}

/** One System One call, one retry, never throws. */
export async function classify(
  input: ClassifyInput,
  post: SystemOnePost = postToGateway,
  model: string | undefined = process.env.MODEL_SERVICE_NAME
): Promise<RawClassification> {
  if (!model) {
    console.error('[classify] MODEL_SERVICE_NAME is not set');
    return safeClassification();
  }
  const body = buildRequest(input, model);
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return parseResponse(await post(body));
    } catch (err) {
      console.warn(`[classify] attempt ${attempt} failed:`, (err as Error).message);
    }
  }
  return safeClassification(model);
}
