import type { Application } from 'express';
import { type Deps, handleTurn } from '../router/orchestrator';
import { callerEmail, h, parse } from './http';
import { RouteRequestSchema } from './schemas';

export function registerRouteEndpoint(app: Application, deps: Deps): void {
  app.post(
    '/api/v1/route',
    h(async (req, res) => {
      const body = parse(RouteRequestSchema, req.body);
      const result = await handleTurn(body, { email: callerEmail(req) }, deps);
      res.json(result);
    })
  );
}
