import { getExecutionContext } from '@databricks/appkit';

export function hostUrl(): string {
  const host = process.env.DATABRICKS_HOST;
  if (!host) throw new Error('DATABRICKS_HOST is not set');
  const stripped = host.replace(/\/+$/, '');
  return stripped.startsWith('http') ? stripped : `https://${stripped}`;
}

export interface DbxRequest {
  method?: 'GET' | 'POST' | 'PUT';
  json?: unknown;
  body?: string | Uint8Array;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

/** Authenticated fetch against the workspace as the app service principal (OAuth M2M injected by the platform). */
export async function dbxFetch(path: string, req: DbxRequest = {}): Promise<Response> {
  const headers = new Headers(req.headers);
  await getExecutionContext().client.config.authenticate(headers);
  let body: string | Uint8Array | undefined = req.body;
  if (req.json !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(req.json);
  }
  return fetch(`${hostUrl()}${path}`, {
    method: req.method ?? (body === undefined ? 'GET' : 'POST'),
    headers,
    body,
    signal: AbortSignal.timeout(req.timeoutMs ?? 15_000),
  });
}

/** Sets the Databricks-managed Request type for JSON calls and throws with the body on non-2xx. */
export async function dbxJson<T>(path: string, req: DbxRequest = {}): Promise<T> {
  const res = await dbxFetch(path, req);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new DbxError(res.status, `${req.method ?? 'GET'} ${path} -> ${res.status} ${text.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

export class DbxError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'DbxError';
  }
}
