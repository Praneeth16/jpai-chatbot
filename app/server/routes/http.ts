import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { z } from 'zod';
import { HttpError } from '../errors';

/** Async handler wrapper: rejected promises reach Express' error middleware. */
export function h(fn: (req: Request, res: Response) => Promise<void>): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    void fn(req, res).catch((err: unknown) => {
      // Known HTTP errors become the JSON body the client reads ({ error }); anything else is a real 500.
      if (err instanceof HttpError && !res.headersSent) {
        res
          .status(err.statusCode)
          .json({ error: err.message, ...(err.details === undefined ? {} : { details: err.details }) });
        return;
      }
      next(err);
    });
  };
}

export function parse<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const r = schema.safeParse(value);
  if (!r.success) throw new HttpError(400, 'invalid request', r.error.issues);
  return r.data;
}

export function callerEmail(req: Request): string | null {
  const v = req.headers['x-forwarded-email'];
  const email = Array.isArray(v) ? v[0] : v;
  if (email) return email;
  return process.env.NODE_ENV === 'development' ? (process.env.DEV_USER_EMAIL ?? null) : null;
}
