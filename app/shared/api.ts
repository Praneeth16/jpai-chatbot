// Types shared by the server (app/server) and the client (app/client).
// Source of truth: docs/CONTRACTS.md section 5 and app/server/routes/openapi.yaml.
// Keep this file dependency-free and erasable (no enums), it is compiled by both tsconfigs.

export const ROUTE_IDS = [
  '0a',
  '0b',
  '0c_greeting',
  '0c_closing',
  '0c_about',
  '1',
  '2',
  '3.1',
  '3.2',
  '4.1',
  '4.2',
  '5.1',
  '5.2',
  '6.1',
  '6.2',
  '7.1',
  '8.1',
  '8.2',
] as const;
export type RouteId = (typeof ROUTE_IDS)[number];

export type Lang = 'ja' | 'en';
export type Audience = 'HCP';
export type PendingClarification = 'target_study' | 'product_focus';

export type IntentChoice =
  | 'unanswerable'
  | 'patient_materials'
  | 'hcp_materials'
  | 'drug_info'
  | 'efficacy_safety'
  | 'website'
  | 'contact_az'
  | 'ambiguous_az'
  | 'report_ae'
  | 'out_of_scope';

export type SmalltalkChoice = 'greeting' | 'closing' | 'about_bot' | 'other';

// ---- POST /api/v1/route ---------------------------------------------------

export interface RouteRequest {
  /** Client-generated uuid, stable for the whole conversation. */
  conversation_id: string;
  message: string;
  lang: Lang;
  audience: Audience;
}

export interface Citation {
  doc_id: string;
  file_name: string;
  doc_rev: string;
  section_path: string;
  title: string;
  /** 1-based PDF pages. Use GET /api/v1/docs/:doc_id/pages/:page to show them. */
  pages: number[];
}

/** Where a verbatim section sits in the interview form (CONTRACTS section 8). */
export interface SectionContext {
  /** Titles of the ancestor sections, outermost first. */
  breadcrumb: string[];
  /** "k/n" when the section is one part of a split section, otherwise null. */
  part: string | null;
  /** Parent section (level 2 or deeper) that GET /api/v1/sections/:section_id can return in full, or null. */
  parent_section_id: string | null;
}

export type TemplateStatus = 'APPROVED' | 'PLACEHOLDER' | 'FALLBACK';

export interface RouteResponseBody {
  /** Approved template id, or null when the text is only a section. */
  template_id: string | null;
  /** APPROVED / PLACEHOLDER as stored, FALLBACK when the built-in wording was used (synced table unavailable). */
  template_status: TemplateStatus | null;
  /** header_text + "\n\n" + section_text for verbatim routes, otherwise header_text. Kept for API compatibility. */
  text: string;
  /** Template wording only. */
  header_text: string;
  /** Verbatim if_sections.markdown (may contain HTML tables), or null when the route answers with a template only. */
  section_text: string | null;
  section_context: SectionContext | null;
  section_ids: string[];
  citations: Citation[];
}

// ---- GET /api/v1/sections/:section_id ----------------------------------------

export interface SectionResponse {
  section_id: string;
  doc_id: string;
  doc_rev: string;
  section_path: string;
  title: string;
  /** Verbatim if_sections.markdown. */
  section_text: string;
  /** Template header; only set for sections that are not approved (5.1 wording), otherwise null. */
  header_text: string | null;
  approved_flag: boolean;
  section_context: SectionContext;
  citation: Citation;
}

/** Thresholds in force for this turn (defaults plus ROUTER_CONFIG overrides), so the UI never hard-codes them. */
export interface Thresholds {
  ae: number;
  injection: number;
  has_request: number;
  intent: number;
  conditions: number;
  retrieval: number;
}

export interface Classification {
  adverse_event: number;
  injection: number;
  has_request: number;
  has_conditions: number;
  smalltalk: { choice: SmalltalkChoice; confidence: number };
  intent: {
    choice: IntentChoice;
    confidence: number;
    probabilities: Record<string, number>;
  };
  product_code: string | null;
  study_ids: string[];
  /** Model that answered, for example system.ai.openjev-qwen35-4b. */
  model: string | null;
  /** True when System One failed and a safe default was used (routes to 2, the message goes to the AE queue as UNCLASSIFIED). */
  degraded: boolean;
  thresholds: Thresholds;
}

export interface RetrievalHit {
  section_id: string;
  score: number;
}

export interface Retrieval {
  query: string;
  filters: Record<string, unknown>;
  top_score: number | null;
  hits: RetrievalHit[];
  /** Set when the search call failed; the turn then falls back to route 2. */
  error?: string;
}

export interface RouteResponse {
  turn_id: string;
  route_id: RouteId;
  response: RouteResponseBody;
  classification: Classification | null;
  retrieval: Retrieval | null;
  pending_clarification: PendingClarification | null;
  /** The text that was classified: pending question + reply when a clarification was pending. */
  merged_message: string;
  ae_logged: boolean;
  trace_id: string | null;
  latency_ms: number;
}

// ---- GET /api/v1/docs -------------------------------------------------------

export interface DocInfo {
  doc_id: string;
  file_name: string;
  product_code: string | null;
  doc_type: string | null;
  doc_rev: string | null;
  revision_date: string | null;
  ingested_at: string | null;
  is_current: boolean;
  section_count: number;
  chunk_count: number;
}

export interface DocsResponse {
  docs: DocInfo[];
  /** 'uc' = docs_registry via SQL warehouse, 'lakebase' = derived from the synced if_sections table. */
  source: 'uc' | 'lakebase';
}

// ---- POST /api/v1/docs/upload (multipart/form-data, field "file") -----------

export interface UploadResponse {
  file_name: string;
  volume_path: string;
  run_id: number | null;
  /** Set when the file was stored but the ingest job could not be started. */
  warning?: string;
}

// ---- GET /api/v1/ops/summary --------------------------------------------------

export interface OpsRecentTurn {
  turn_id: string;
  conversation_id: string;
  message: string;
  route_id: string;
  template_id: string | null;
  latency_ms: number | null;
  trace_id: string | null;
  created_at: string;
}

export interface OpsSummary {
  window_days: number;
  route_counts: { route_id: string; count: number }[];
  total_turns: number;
  ae_queue: { status: string; count: number }[];
  avg_latency_ms: number | null;
  /** Empty for non-admins: they see counts only. */
  recent_turns: OpsRecentTurn[];
  is_admin: boolean;
}

// ---- GET /api/v1/health, GET /api/me -----------------------------------------

export interface HealthResponse {
  status: 'ok' | 'degraded';
  checks: { lakebase: boolean; classifier_configured: boolean; search_configured: boolean; tracing: boolean };
  version: string;
}

export interface MeResponse {
  email: string | null;
  /** The caller is listed in ADMIN_EMAILS (upload, raw ops messages, "Why this route?" panel). */
  is_admin: boolean;
}

export interface ApiError {
  error: string;
  details?: unknown;
}
