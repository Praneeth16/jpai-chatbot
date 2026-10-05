-- App-owned schema (CONTRACTS section 3). Idempotent: safe to run on every start.
CREATE SCHEMA IF NOT EXISTS app;

CREATE TABLE IF NOT EXISTS app.conversation_state (
  conversation_id TEXT PRIMARY KEY,
  user_email TEXT,
  lang TEXT DEFAULT 'ja',
  pending_clarification TEXT,
  pending_question TEXT,
  off_topic_streak INT DEFAULT 0,
  last_product_code TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.turn_log (
  turn_id UUID PRIMARY KEY,
  conversation_id TEXT,
  user_email TEXT,
  message TEXT,
  merged_message TEXT,
  route_id TEXT,
  template_id TEXT,
  section_ids TEXT[],
  classification JSONB,
  retrieval JSONB,
  model_ids JSONB,
  trace_id TEXT,
  latency_ms INT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.ae_queue (
  ae_id UUID PRIMARY KEY,
  turn_id UUID,
  conversation_id TEXT,
  message TEXT,
  ae_probability DOUBLE PRECISION,
  status TEXT DEFAULT 'NEW',
  created_at TIMESTAMPTZ DEFAULT now(),
  notified_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS turn_log_conversation_idx ON app.turn_log (conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS turn_log_created_idx ON app.turn_log (created_at DESC);
CREATE INDEX IF NOT EXISTS ae_queue_status_idx ON app.ae_queue (status, created_at);
