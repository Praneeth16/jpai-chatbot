import type {
  Audience,
  Classification,
  IntentChoice,
  Lang,
  PendingClarification,
  SmalltalkChoice,
} from '../../shared/api';

/** Persistent per-conversation state (app.conversation_state). */
export interface ConversationState {
  conversation_id: string;
  lang: Lang;
  pending_clarification: PendingClarification | null;
  pending_question: string | null;
  off_topic_streak: number;
  last_product_code: string | null;
}

export function emptyState(conversationId: string, lang: Lang = 'ja'): ConversationState {
  return {
    conversation_id: conversationId,
    lang,
    pending_clarification: null,
    pending_question: null,
    off_topic_streak: 0,
    last_product_code: null,
  };
}

/** What System One returned, before master data is added. */
export type RawClassification = Omit<Classification, 'product_code' | 'study_ids' | 'thresholds'>;

export interface MasterMatch {
  product_code: string | null;
  study_ids: string[];
  /** Normalised terms that matched, for traces. */
  matched_terms: { term: string; kind: 'product' | 'study' | 'indication'; target_id: string }[];
}

export interface SearchFilters {
  product_code: string;
  is_current: true;
  /** Request audience, matched against the index column (CONTRACTS section 8). */
  audience: Audience;
  /** Only set when unapproved sections must be excluded (4.x). Omitted for 5.1 with audience HCP. */
  approved_flag?: true;
  study_id?: string;
}

export interface NeedsSearch {
  filters: SearchFilters;
  mode: 'subsection' | 'section';
  query: string;
}

export interface Decision {
  route_id: import('../../shared/api').RouteId;
  needs_search: NeedsSearch | null;
  /** Template for non-search routes, header template for 4.x / 5.1. */
  template_id: string | null;
  new_state: ConversationState;
  /** Route 1: the orchestrator must write app.ae_queue. */
  ae: boolean;
}

export interface DecideInput {
  message: string;
  merged_message: string;
  is_clarification: boolean;
  precheck_ok: boolean;
  classification: RawClassification;
  masterdata: MasterMatch;
  state: ConversationState;
  audience: Audience;
}

export type { IntentChoice, SmalltalkChoice };
