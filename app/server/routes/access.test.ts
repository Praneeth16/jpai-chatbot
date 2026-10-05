import type { Application, Request, RequestHandler, Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { config, MASTER } from '../router/fixtures';
import type { Deps } from '../router/orchestrator';
import type { SectionRow, Store } from '../router/store';
import type { Db, Row } from '../types';
import { adminEmails, isAdminEmail, requireAdmin } from './access';
import { registerDocsEndpoints, uploadFileName } from './docs';
import { registerOpsEndpoint } from './ops';
import { registerSectionsEndpoint } from './sections';
import { registerSystemEndpoints } from './system';

const req = (email?: string, extra: Partial<Request> = {}): Request =>
  ({ headers: email ? { 'x-forwarded-email': email } : {}, params: {}, query: {}, ...extra }) as unknown as Request;

function fakeRes() {
  const out: { status: number; body: unknown } = { status: 200, body: undefined };
  const res = {
    headersSent: false,
    status(code: number) {
      out.status = code;
      return res;
    },
    json(b: unknown) {
      out.body = b;
      return res;
    },
  };
  return { res: res as unknown as Response, out };
}

/** Captures the route handlers registered on a fake Express app. */
function fakeApp() {
  const handlers = new Map<string, RequestHandler[]>();
  const app = {
    get: (path: string, ...h: RequestHandler[]) => handlers.set(`GET ${path}`, h),
    post: (path: string, ...h: RequestHandler[]) => handlers.set(`POST ${path}`, h),
  } as unknown as Application;
  const call = async (key: string, r: Request) => {
    const { res, out } = fakeRes();
    const list = handlers.get(key) ?? [];
    await new Promise<void>((resolve) => {
      const run = (i: number): void => {
        if (i >= list.length) return resolve();
        const before = out.body;
        void list[i](r, res, () => run(i + 1));
        // handlers that answer themselves never call next: give them a tick to finish
        setTimeout(() => (out.body !== before || i === list.length - 1 ? resolve() : undefined), 5);
      };
      run(0);
    });
    return out;
  };
  return { app, call };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('ADMIN_EMAILS', () => {
  it('parses a comma list, case-insensitively, and an empty list means nobody', () => {
    expect([...adminEmails(' A@x.com, b@x.com ,,')]).toEqual(['a@x.com', 'b@x.com']);
    expect(isAdminEmail('B@X.com', 'a@x.com,b@x.com')).toBe(true);
    expect(isAdminEmail('c@x.com', 'a@x.com')).toBe(false);
    expect(isAdminEmail(null, 'a@x.com')).toBe(false);
    expect(isAdminEmail('a@x.com', '')).toBe(false);
    expect(isAdminEmail('a@x.com', undefined)).toBe(false);
  });

  it('requireAdmin lets admins through and answers 403 to everyone else', () => {
    vi.stubEnv('ADMIN_EMAILS', 'boss@x.com');
    const next = vi.fn();
    const ok = fakeRes();
    requireAdmin(req('boss@x.com'), ok.res, next);
    expect(next).toHaveBeenCalledOnce();

    for (const r of [req('dr@x.com'), req()]) {
      const denied = fakeRes();
      requireAdmin(r, denied.res, next);
      expect(denied.out.status).toBe(403);
    }
    expect(next).toHaveBeenCalledOnce();
  });

  it('GET /api/me reports is_admin', async () => {
    vi.stubEnv('ADMIN_EMAILS', 'boss@x.com');
    const { app, call } = fakeApp();
    registerSystemEndpoints(app, { query: () => Promise.resolve({ rows: [] }) });
    expect((await call('GET /api/me', req('boss@x.com'))).body).toEqual({ email: 'boss@x.com', is_admin: true });
    expect((await call('GET /api/me', req('dr@x.com'))).body).toEqual({ email: 'dr@x.com', is_admin: false });
    expect((await call('GET /api/me', req())).body).toEqual({ email: null, is_admin: false });
  });
});

describe('GET /api/v1/ops/summary', () => {
  const rows = (text: string): Row[] => {
    if (text.includes('GROUP BY route_id')) return [{ route_id: '4.2', count: 3 }];
    if (text.includes('GROUP BY status')) return [{ status: 'UNCLASSIFIED', count: 1 }];
    if (text.includes('avg(')) return [{ avg: 1200 }];
    return [
      {
        turn_id: 't',
        conversation_id: 'c',
        message: 'secret question',
        route_id: '4.2',
        template_id: null,
        latency_ms: 10,
        trace_id: null,
        created_at: new Date(0),
      },
    ];
  };
  const queries: string[] = [];
  const db: Db = {
    query: (t) => {
      queries.push(t);
      return Promise.resolve({ rows: rows(t) });
    },
  };

  it('admins see the raw recent turns', async () => {
    vi.stubEnv('ADMIN_EMAILS', 'boss@x.com');
    const { app, call } = fakeApp();
    registerOpsEndpoint(app, db);
    const out = await call('GET /api/v1/ops/summary', req('boss@x.com'));
    expect(out.body).toMatchObject({ is_admin: true, total_turns: 3 });
    expect((out.body as { recent_turns: { message: string }[] }).recent_turns[0].message).toBe('secret question');
  });

  it('non-admins get counts only and the messages are not even queried', async () => {
    vi.stubEnv('ADMIN_EMAILS', 'boss@x.com');
    queries.length = 0;
    const { app, call } = fakeApp();
    registerOpsEndpoint(app, db);
    const out = await call('GET /api/v1/ops/summary', req('dr@x.com'));
    expect(out.body).toMatchObject({
      is_admin: false,
      total_turns: 3,
      recent_turns: [],
      ae_queue: [{ status: 'UNCLASSIFIED', count: 1 }],
    });
    expect(JSON.stringify(out.body)).not.toContain('secret question');
    expect(queries.some((q) => q.includes('message'))).toBe(false);
  });
});

describe('POST /api/v1/docs/upload', () => {
  it('is 403 for non-admins before any body is read, and reaches the upload handler for admins', async () => {
    vi.stubEnv('ADMIN_EMAILS', 'boss@x.com');
    const { app, call } = fakeApp();
    registerDocsEndpoints(app, { query: () => Promise.resolve({ rows: [] }) });
    const denied = await call('POST /api/v1/docs/upload', req('dr@x.com'));
    expect(denied).toEqual({ status: 403, body: { error: 'admin access required' } });
  });
});

describe('uploadFileName', () => {
  it('lower-cases the extension and keeps the name path safe', () => {
    expect(uploadFileName('IF_v3.PDF')).toBe('IF_v3.pdf');
    expect(uploadFileName('a.Pdf')).toBe('a.pdf');
    expect(uploadFileName('no-extension')).toBe('no-extension.pdf');
    expect(uploadFileName('../../etc/pass wd.pdf')).toBe('pass_wd.pdf');
    expect(uploadFileName('.PDF')).toBe('upload.pdf');
  });
  it('restores UTF-8 names that multer decoded as latin1', () => {
    const latin1 = Buffer.from('イジュド_IF.PDF', 'utf8').toString('latin1');
    expect(uploadFileName(latin1)).toBe('イジュド_IF.pdf');
  });
});

describe('GET /api/v1/sections/:section_id', () => {
  const row = (over: Partial<SectionRow> = {}): SectionRow => ({
    section_id: 'd::Ⅳ.1',
    doc_id: 'JD',
    doc_rev: 'r',
    section_path: 'Ⅳ.1',
    title: '組成',
    markdown: '本文',
    pages: [12],
    approved_flag: true,
    level: 2,
    is_current: true,
    qa_status: 'AUTO',
    char_len: 2,
    parent_section_id: 'd::Ⅳ',
    parent_level: 1,
    part_count: 0,
    is_pseudo: false,
    ...over,
  });
  const deps = (found: SectionRow | null, over: Partial<Store> = {}): Deps => ({
    config: config(),
    store: {
      section: () => Promise.resolve(found),
      breadcrumb: () => Promise.resolve(['Ⅳ']),
      subtreeUnapproved: () => Promise.resolve(false),
      fileName: () => Promise.resolve('JD_v3.pdf'),
      templates: () => Promise.resolve([]),
      masterData: () => Promise.resolve(MASTER),
      ...over,
    } as unknown as Store,
  });
  const get = async (d: Deps, lang?: string) => {
    const { app, call } = fakeApp();
    registerSectionsEndpoint(app, d);
    return call(
      'GET /api/v1/sections/:section_id',
      req('dr@x.com', { params: { section_id: 'd::Ⅳ.1' }, query: lang ? { lang } : {} } as Partial<Request>)
    );
  };

  it('returns the verbatim section with context and the registry file name', async () => {
    const out = await get(deps(row()));
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({
      section_id: 'd::Ⅳ.1',
      section_text: '本文',
      header_text: null,
      approved_flag: true,
      section_context: { breadcrumb: ['Ⅳ'], part: null, parent_section_id: null },
      citation: { file_name: 'JD_v3.pdf', pages: [12] },
    });
  });

  it('404 for a missing section, a chapter, FRONT, REJECTED or not current', async () => {
    expect((await get(deps(null))).status).toBe(404);
    for (const over of [{ level: 1 }, { section_path: 'FRONT' }, { qa_status: 'REJECTED' }, { is_current: false }]) {
      expect((await get(deps(row(over)))).status, JSON.stringify(over)).toBe(404);
    }
  });

  it('403 when an approved section contains an unapproved sub-section', async () => {
    const out = await get(deps(row(), { subtreeUnapproved: () => Promise.resolve(true) }));
    expect(out.status).toBe(403);
  });

  it('an unapproved (clinical) section comes with the 5.1 header, as route 5.1 would', async () => {
    const out = await get(deps(row({ approved_flag: false })), 'en');
    expect(out.status).toBe(200);
    expect((out.body as { header_text: string }).header_text).toMatch(/clinical study information/);
  });

  it('exposes the parent when it is level 2 or deeper', async () => {
    const out = await get(deps(row({ level: 3, parent_section_id: 'd::Ⅳ.1', parent_level: 2 })));
    expect((out.body as { section_context: { parent_section_id: string } }).section_context.parent_section_id).toBe(
      'd::Ⅳ.1'
    );
  });

  it('a Lakebase failure is 503, not an unhandled 500', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const out = await get(deps(null, { section: () => Promise.reject(new Error('down')) }));
    expect(out.status).toBe(503);
    vi.restoreAllMocks();
  });
});
