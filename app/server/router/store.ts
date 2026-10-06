import type { Lang, PendingClarification } from '../../shared/api';
import type { Cell, Db, Queryable } from '../types';
import type { SectionMeta } from './flow';
import type { MasterData, ProductRow, StudyRow, SynonymRow } from './masterdata';
import type { TemplateRow } from './templates';
import { type ConversationState, emptyState } from './types';

/** One if_sections row as the router needs it to answer (and to re-check that it may be answered). */
export interface SectionRow {
  section_id: string;
  doc_id: string;
  doc_rev: string;
  section_path: string;
  title: string;
  markdown: string;
  pages: number[];
  approved_flag: boolean;
  level: number;
  is_current: boolean;
  qa_status: string | null;
  char_len: number | null;
  parent_section_id: string | null;
  /** Level of the parent, null for a chapter. */
  parent_level: number | null;
  /** Number of pseudo-sections that share this section's parent (0 when this section is not a split part). */
  part_count: number;
  is_pseudo: boolean;
}

export interface TurnLogRow {
  turn_id: string;
  conversation_id: string;
  user_email: string | null;
  message: string;
  merged_message: string;
  route_id: string;
  template_id: string | null;
  section_ids: string[];
  classification: unknown;
  retrieval: unknown;
  model_ids: unknown;
  trace_id: string | null;
  latency_ms: number;
}

export interface AeRow {
  ae_id: string;
  turn_id: string;
  conversation_id: string;
  message: string;
  /** Null when the classifier was unavailable. */
  ae_probability: number | null;
  /** NEW = classified as an AE, REVIEW = possible AE answered normally, UNCLASSIFIED = classifier down. */
  status: 'NEW' | 'REVIEW' | 'UNCLASSIFIED';
}

/** Everything the orchestrator reads or writes in Lakebase. Tests replace it with an in-memory version. */
export interface Store {
  /** A state row owned by another user is ignored (CONTRACTS section 8). */
  getState(conversationId: string, lang: Lang, userEmail: string | null): Promise<ConversationState>;
  saveState(state: ConversationState, userEmail: string | null): Promise<void>;
  recentTurns(
    conversationId: string,
    limit: number,
    userEmail: string | null
  ): Promise<{ user_message: string; route_id: string }[]>;
  masterData(): Promise<MasterData>;
  templates(): Promise<TemplateRow[]>;
  lineage(sectionIds: string[]): Promise<SectionMeta[]>;
  section(sectionId: string): Promise<SectionRow | null>;
  /** Titles of the ancestors of a section, outermost first. */
  breadcrumb(sectionId: string): Promise<string[]>;
  /** True when any descendant of the section is not approved. */
  subtreeUnapproved(sectionId: string): Promise<boolean>;
  /** docs_registry.file_name; falls back to the doc_id when the registry has no row. */
  fileName(docId: string): Promise<string>;
  logTurn(row: TurnLogRow): Promise<void>;
  logAe(row: AeRow): Promise<void>;
  /** turn_log and ae_queue in one transaction when the database supports it. */
  logTurnWithAe(turn: TurnLogRow, ae: AeRow): Promise<void>;
}

const TTL_MS = 5 * 60 * 1000;

export function refSchema(raw: string | undefined = process.env.REF_SCHEMA): string {
  if (!raw || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(raw)) {
    throw new Error('REF_SCHEMA must be set to a plain schema name');
  }
  return `"${raw}"`;
}

function cached<T>(load: () => Promise<T>): () => Promise<T> {
  let value: T | undefined;
  let expires = 0;
  return async () => {
    if (value !== undefined && Date.now() < expires) return value;
    value = await load();
    expires = Date.now() + TTL_MS;
    return value;
  };
}

const str = (v: Cell): string | null => (v == null ? null : String(v));
const bool = (v: Cell): boolean => v === true || v === 't' || v === 'true';
const strArray = (v: Cell): string[] => (Array.isArray(v) ? v.map(String) : []);

// Idempotent on the primary key, so a retry after an unknown outcome never fails on a duplicate.
async function insertTurn(q: Queryable, t: TurnLogRow): Promise<void> {
  await q.query(
    `INSERT INTO app.turn_log
       (turn_id, conversation_id, user_email, message, merged_message, route_id, template_id, section_ids,
        classification, retrieval, model_ids, trace_id, latency_ms)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (turn_id) DO NOTHING`,
    [
      t.turn_id,
      t.conversation_id,
      t.user_email,
      t.message,
      t.merged_message,
      t.route_id,
      t.template_id,
      t.section_ids,
      JSON.stringify(t.classification),
      JSON.stringify(t.retrieval),
      JSON.stringify(t.model_ids),
      t.trace_id,
      t.latency_ms,
    ]
  );
}

async function insertAe(q: Queryable, a: AeRow): Promise<void> {
  await q.query(
    `INSERT INTO app.ae_queue (ae_id, turn_id, conversation_id, message, ae_probability, status)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (ae_id) DO NOTHING`,
    [a.ae_id, a.turn_id, a.conversation_id, a.message, a.ae_probability, a.status]
  );
}

export function createStore(db: Db, schema: string = refSchema()): Store {
  const fileNames = new Map<string, string>();

  const loadMasterData = cached(async (): Promise<MasterData> => {
    const [syn, prod, stud] = await Promise.all([
      db.query(`SELECT term, kind, target_id FROM ${schema}.synonyms`),
      db.query(
        `SELECT product_code, brand_ja, brand_en, generic_ja, generic_en, patient_materials_url, product_info_url
           FROM ${schema}.products`
      ),
      db.query(`SELECT study_id, study_code, product_codes FROM ${schema}.studies`),
    ]);
    const synonyms = syn.rows
      .filter((r) => ['product', 'study', 'indication'].includes(String(r.kind)))
      .map((r) => ({
        term: String(r.term),
        kind: String(r.kind) as SynonymRow['kind'],
        target_id: String(r.target_id),
      }));
    const products: ProductRow[] = prod.rows.map((r) => ({
      product_code: String(r.product_code),
      brand_ja: str(r.brand_ja),
      brand_en: str(r.brand_en),
      generic_ja: str(r.generic_ja),
      generic_en: str(r.generic_en),
      patient_materials_url: str(r.patient_materials_url),
      product_info_url: str(r.product_info_url),
    }));
    const studies: StudyRow[] = stud.rows.map((r) => ({
      study_id: String(r.study_id),
      study_code: str(r.study_code),
      product_codes: strArray(r.product_codes),
    }));
    return { synonyms, products, studies };
  });

  const loadTemplates = cached(async (): Promise<TemplateRow[]> => {
    const { rows } = await db.query(
      `SELECT template_id, route_id, lang, text, version, status FROM ${schema}.templates`
    );
    return rows.map((r) => ({
      template_id: String(r.template_id),
      route_id: String(r.route_id),
      lang: String(r.lang),
      text: String(r.text),
      version: Number(r.version ?? 0),
      status: String(r.status ?? 'PLACEHOLDER'),
    }));
  });

  return {
    async getState(conversationId, lang, userEmail) {
      const { rows } = await db.query(
        `SELECT user_email, lang, pending_clarification, pending_question, off_topic_streak, last_product_code
           FROM app.conversation_state WHERE conversation_id = $1`,
        [conversationId]
      );
      const r = rows[0];
      if (!r) return emptyState(conversationId, lang);
      const owner = str(r.user_email);
      if (owner !== null && owner.toLowerCase() !== (userEmail ?? '').toLowerCase()) {
        return emptyState(conversationId, lang);
      }
      return {
        conversation_id: conversationId,
        lang,
        pending_clarification: (str(r.pending_clarification) as PendingClarification | null) ?? null,
        pending_question: str(r.pending_question),
        off_topic_streak: Number(r.off_topic_streak ?? 0),
        last_product_code: str(r.last_product_code),
      };
    },

    async saveState(s, userEmail) {
      await db.query(
        `INSERT INTO app.conversation_state
           (conversation_id, user_email, lang, pending_clarification, pending_question, off_topic_streak,
            last_product_code, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, now())
         ON CONFLICT (conversation_id) DO UPDATE SET
           user_email = EXCLUDED.user_email, lang = EXCLUDED.lang,
           pending_clarification = EXCLUDED.pending_clarification, pending_question = EXCLUDED.pending_question,
           off_topic_streak = EXCLUDED.off_topic_streak, last_product_code = EXCLUDED.last_product_code,
           updated_at = now()`,
        [
          s.conversation_id,
          userEmail,
          s.lang,
          s.pending_clarification,
          s.pending_question,
          s.off_topic_streak,
          s.last_product_code,
        ]
      );
    },

    async recentTurns(conversationId, limit, userEmail) {
      const { rows } = await db.query(
        `SELECT message, route_id FROM app.turn_log
          WHERE conversation_id = $1 AND user_email IS NOT DISTINCT FROM $3
          ORDER BY created_at DESC LIMIT $2`,
        [conversationId, limit, userEmail]
      );
      return rows.reverse().map((r) => ({ user_message: String(r.message), route_id: String(r.route_id) }));
    },

    masterData: loadMasterData,
    templates: loadTemplates,

    async lineage(sectionIds) {
      if (sectionIds.length === 0) return [];
      const cols = 'section_id, section_path, level, parent_section_id, char_len, is_current, qa_status, approved_flag';
      const { rows } = await db.query(
        `WITH RECURSIVE t AS (
           SELECT ${cols} FROM ${schema}.if_sections WHERE section_id = ANY($1)
           UNION
           SELECT ${cols.replace(/(\w+)/g, 's.$1')}
             FROM ${schema}.if_sections s JOIN t ON s.section_id = t.parent_section_id
         ) SELECT ${cols} FROM t`,
        [sectionIds]
      );
      return rows.map((r) => ({
        section_id: String(r.section_id),
        section_path: String(r.section_path ?? ''),
        level: Number(r.level),
        parent_section_id: str(r.parent_section_id),
        char_len: r.char_len == null ? null : Number(r.char_len),
        is_current: bool(r.is_current),
        qa_status: str(r.qa_status),
        approved_flag: bool(r.approved_flag),
      }));
    },

    async section(sectionId) {
      const { rows } = await db.query(
        `SELECT s.section_id, s.doc_id, s.doc_rev, s.section_path, s.title, s.markdown, s.pages, s.approved_flag,
                s.level, s.is_current, s.qa_status, s.char_len, s.parent_section_id, s.is_pseudo,
                p.level AS parent_level,
                (SELECT count(*)::int FROM ${schema}.if_sections c
                  WHERE s.is_pseudo AND c.parent_section_id = s.parent_section_id AND c.is_pseudo) AS part_count
           FROM ${schema}.if_sections s
           LEFT JOIN ${schema}.if_sections p ON p.section_id = s.parent_section_id
          WHERE s.section_id = $1`,
        [sectionId]
      );
      const r = rows[0];
      if (!r) return null;
      return {
        section_id: String(r.section_id),
        doc_id: String(r.doc_id),
        doc_rev: String(r.doc_rev ?? ''),
        section_path: String(r.section_path ?? ''),
        title: String(r.title ?? ''),
        markdown: String(r.markdown ?? ''),
        pages: Array.isArray(r.pages) ? r.pages.map(Number) : [],
        approved_flag: bool(r.approved_flag),
        level: Number(r.level),
        is_current: bool(r.is_current),
        qa_status: str(r.qa_status),
        char_len: r.char_len == null ? null : Number(r.char_len),
        parent_section_id: str(r.parent_section_id),
        parent_level: r.parent_level == null ? null : Number(r.parent_level),
        part_count: Number(r.part_count ?? 0),
        is_pseudo: bool(r.is_pseudo),
      };
    },

    async breadcrumb(sectionId) {
      const { rows } = await db.query(
        `WITH RECURSIVE a AS (
           SELECT parent_section_id AS id, 1 AS depth FROM ${schema}.if_sections WHERE section_id = $1
           UNION ALL
           SELECT s.parent_section_id, a.depth + 1 FROM ${schema}.if_sections s JOIN a ON s.section_id = a.id
         ) SELECT s.title, a.depth FROM a JOIN ${schema}.if_sections s ON s.section_id = a.id ORDER BY a.depth DESC`,
        [sectionId]
      );
      return rows.map((r) => String(r.title ?? ''));
    },

    async subtreeUnapproved(sectionId) {
      const { rows } = await db.query(
        `WITH RECURSIVE d AS (
           SELECT section_id, approved_flag FROM ${schema}.if_sections WHERE parent_section_id = $1
           UNION ALL
           SELECT s.section_id, s.approved_flag FROM ${schema}.if_sections s JOIN d ON s.parent_section_id = d.section_id
         ) SELECT count(*)::int AS n FROM d WHERE approved_flag IS NOT TRUE`,
        [sectionId]
      );
      return Number(rows[0]?.n ?? 0) > 0;
    },

    async fileName(docId) {
      const known = fileNames.get(docId);
      if (known) return known;
      const { rows } = await db.query(`SELECT file_name FROM ${schema}.docs_registry WHERE doc_id = $1`, [docId]);
      const name = str(rows[0]?.file_name);
      if (!name) return docId;
      fileNames.set(docId, name);
      return name;
    },

    async logTurn(t) {
      await insertTurn(db, t);
    },

    async logAe(a) {
      await insertAe(db, a);
    },

    async logTurnWithAe(t, a) {
      if (!db.transaction) {
        await insertTurn(db, t);
        await insertAe(db, a);
        return;
      }
      await db.transaction(async (tx) => {
        await insertTurn(tx, t);
        await insertAe(tx, a);
      });
    },
  };
}
