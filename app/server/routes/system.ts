import type { Application } from 'express';
import type { HealthResponse, MeResponse } from '../../shared/api';
import { tracingEnabled } from '../router/trace';
import type { Db } from '../types';
import { isAdminEmail } from './access';
import { callerEmail, h } from './http';

export function registerSystemEndpoints(app: Application, db: Db): void {
  app.get(
    '/api/v1/health',
    h(async (_req, res) => {
      const lakebase = await db
        .query('SELECT 1')
        .then(() => true)
        .catch(() => false);
      const checks: HealthResponse['checks'] = {
        lakebase,
        classifier_configured: Boolean(process.env.MODEL_SERVICE_NAME),
        search_configured: Boolean(process.env.AI_SEARCH_INDEX),
        tracing: tracingEnabled(),
      };
      const body: HealthResponse = {
        status: lakebase && checks.classifier_configured && checks.search_configured ? 'ok' : 'degraded',
        checks,
        version: '1.0.0',
      };
      res.status(lakebase ? 200 : 503).json(body);
    })
  );

  app.get(
    '/api/me',
    h((req, res) => {
      const email = callerEmail(req);
      const body: MeResponse = { email, is_admin: isAdminEmail(email) };
      res.json(body);
      return Promise.resolve();
    })
  );
}
