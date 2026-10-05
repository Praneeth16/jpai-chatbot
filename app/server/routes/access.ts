import type { NextFunction, Request, Response } from 'express';
import { callerEmail } from './http';

/** ADMIN_EMAILS: comma separated, case-insensitive. Empty or unset means nobody is an admin. */
export function adminEmails(raw: string | undefined = process.env.ADMIN_EMAILS): Set<string> {
  return new Set(
    (raw ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
  );
}

export function isAdminEmail(email: string | null, raw?: string): boolean {
  return email !== null && adminEmails(raw).has(email.trim().toLowerCase());
}

export const isAdmin = (req: Request): boolean => isAdminEmail(callerEmail(req));

/** Express middleware: 403 unless the caller is an admin. Placed before body parsing so a 100 MB upload is not read. */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (isAdmin(req)) {
    next();
    return;
  }
  res.status(403).json({ error: 'admin access required' });
}
