import type { Application } from 'express';
import type { OpsSummary } from '../../shared/api';
import type { Db } from '../types';
import { isAdmin } from './access';
import { h } from './http';

const WINDOW_DAYS = 7;

export function registerOpsEndpoint(app: Application, db: Db): void {
  app.get(
    '/api/v1/ops/summary',
    h(async (req, res) => {
      // Raw user messages are for admins only; everyone else gets counts (CONTRACTS section 8).
      const admin = isAdmin(req);
      const [routes, ae, recent, latency] = await Promise.all([
        db.query(
          `SELECT route_id, count(*)::int AS count FROM app.turn_log
            WHERE created_at >= now() - make_interval(days => $1)
            GROUP BY route_id ORDER BY count DESC`,
          [WINDOW_DAYS]
        ),
        db.query(`SELECT status, count(*)::int AS count FROM app.ae_queue GROUP BY status ORDER BY status`),
        admin
          ? db.query(
              `SELECT turn_id, conversation_id, message, route_id, template_id, latency_ms, trace_id, created_at
                 FROM app.turn_log ORDER BY created_at DESC LIMIT 20`
            )
          : Promise.resolve({ rows: [] }),
        db.query(
          `SELECT avg(latency_ms)::float AS avg FROM app.turn_log
            WHERE created_at >= now() - make_interval(days => $1)`,
          [WINDOW_DAYS]
        ),
      ]);
      const route_counts = routes.rows.map((r) => ({ route_id: String(r.route_id), count: Number(r.count) }));
      const body: OpsSummary = {
        is_admin: admin,
        window_days: WINDOW_DAYS,
        route_counts,
        total_turns: route_counts.reduce((n, r) => n + r.count, 0),
        ae_queue: ae.rows.map((r) => ({ status: String(r.status), count: Number(r.count) })),
        avg_latency_ms: latency.rows[0]?.avg == null ? null : Math.round(Number(latency.rows[0].avg)),
        recent_turns: recent.rows.map((r) => ({
          turn_id: String(r.turn_id),
          conversation_id: String(r.conversation_id),
          message: String(r.message ?? ''),
          route_id: String(r.route_id),
          template_id: r.template_id == null ? null : String(r.template_id),
          latency_ms: r.latency_ms == null ? null : Number(r.latency_ms),
          trace_id: r.trace_id == null ? null : String(r.trace_id),
          created_at: new Date(r.created_at as string | Date).toISOString(),
        })),
      };
      res.json(body);
    })
  );
}
