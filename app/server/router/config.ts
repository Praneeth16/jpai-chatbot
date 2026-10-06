import { z } from 'zod';
import type { Thresholds } from '../../shared/api';

// Thresholds from CONTRACTS section 6. Override with the ROUTER_CONFIG env var (JSON, same keys).
const ConfigSchema = z.object({
  tau_ae: z.number().min(0).max(1).default(0.35),
  /** At or above: the turn is answered with route 1. Between tau_ae and this: queued for PV review, routed normally. */
  tau_ae_route: z.number().min(0).max(1).default(0.8),
  tau_inj: z.number().min(0).max(1).default(0.6),
  tau_req: z.number().min(0).max(1).default(0.3),
  tau_intent: z.number().min(0).max(1).default(0.5),
  tau_cond: z.number().min(0).max(1).default(0.5),
  /** Minimum retrieval score; 0.0 until tuned on the eval set. */
  tau_ret: z.number().default(0),
  /**
   * 4.1 / 4.2: a section whose title is covered by the cleaned query by at least this share is chosen instead of the
   * vector-search section (minimum share of the title covered, 0..1). 1.01 disables the title match (no score reaches it).
   */
  tau_title: z.number().min(0).max(1.01).default(0.6),
  /** Consecutive off-topic turns before route 8.2. */
  off_topic_streak: z.number().int().min(1).default(3),
  /** 4.1 prefers the deepest section among hits scoring within this relative margin of the best hit. */
  depth_margin: z.number().min(0).max(1).default(0.1),
  num_results: z.number().int().min(1).max(50).default(8),
  /** 4.2 walks up to the largest ancestor whose verbatim text is at most this many characters (CONTRACTS section 8). */
  max_verbatim_chars: z.number().int().min(1).default(8000),
  /** false: every qa_status except REJECTED may be answered. true: only APPROVED (CONTRACTS section 8). */
  require_qa_approved: z.boolean().default(false),
});

export type RouterConfig = z.infer<typeof ConfigSchema>;

export const DEFAULT_CONFIG: RouterConfig = ConfigSchema.parse({});

export function loadConfig(raw: string | undefined = process.env.ROUTER_CONFIG): RouterConfig {
  if (!raw || !raw.trim()) return DEFAULT_CONFIG;
  try {
    return ConfigSchema.parse(JSON.parse(raw));
  } catch (err) {
    console.warn('[router] ROUTER_CONFIG is invalid, using defaults:', (err as Error).message);
    return DEFAULT_CONFIG;
  }
}

export function thresholdsOf(c: RouterConfig): Thresholds {
  return {
    ae: c.tau_ae,
    ae_route: c.tau_ae_route,
    injection: c.tau_inj,
    has_request: c.tau_req,
    intent: c.tau_intent,
    conditions: c.tau_cond,
    retrieval: c.tau_ret,
    title: c.tau_title,
  };
}
