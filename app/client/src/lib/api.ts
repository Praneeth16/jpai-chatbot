import type {
  DocsResponse,
  Lang,
  MeResponse,
  OpsSummary,
  RouteRequest,
  RouteResponse,
  SectionResponse,
  UploadResponse,
} from '../../../shared/api.ts';
import { HttpError } from './http.ts';
import * as mock from './mock.ts';

export const MOCK = import.meta.env.VITE_MOCK === '1';

async function readError(res: Response): Promise<HttpError> {
  let message = `HTTP ${res.status}`;
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === 'string') message = body.error;
  } catch {
    // non-JSON error body: keep the status message
  }
  return new HttpError(res.status, message);
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as T;
}

export function newConversationId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return 'c-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

export async function postRoute(conversationId: string, message: string, lang: Lang): Promise<RouteResponse> {
  if (MOCK) return mock.route(message, lang);
  const body: RouteRequest = { conversation_id: conversationId, message, lang, audience: 'HCP' };
  const res = await fetch('/api/v1/route', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as RouteResponse;
}

export async function getDocs(): Promise<DocsResponse> {
  if (MOCK) return mock.docs();
  return getJson<DocsResponse>('/api/v1/docs');
}

export async function uploadDoc(file: File): Promise<UploadResponse> {
  if (MOCK) return mock.upload(file);
  const form = new FormData();
  form.append('file', file);
  const res = await fetch('/api/v1/docs/upload', { method: 'POST', body: form });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as UploadResponse;
}

export async function getOps(): Promise<OpsSummary> {
  if (MOCK) return mock.ops();
  return getJson<OpsSummary>('/api/v1/ops/summary');
}

/** Fetches a page image and returns an object URL. Throws HttpError (404 when the page is unavailable). */
export async function getPageImage(docId: string, page: number): Promise<string> {
  if (MOCK) return mock.pageImage(docId, page);
  const res = await fetch(`/api/v1/docs/${encodeURIComponent(docId)}/pages/${page}`);
  if (!res.ok) throw await readError(res);
  return URL.createObjectURL(await res.blob());
}

export async function getMe(): Promise<MeResponse> {
  if (MOCK) return mock.me();
  return getJson<MeResponse>('/api/me');
}

/** The full verbatim section behind "show full parent section". */
export async function getSection(sectionId: string, lang: Lang): Promise<SectionResponse> {
  if (MOCK) return mock.section(sectionId, lang);
  return getJson<SectionResponse>(`/api/v1/sections/${encodeURIComponent(sectionId)}?lang=${lang}`);
}
