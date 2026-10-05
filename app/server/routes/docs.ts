import type { Application } from 'express';
import multer from 'multer';
import path from 'node:path';
import type { DocInfo, DocsResponse, UploadResponse } from '../../shared/api';
import { HttpError } from '../errors';
import { dbxFetch, dbxJson } from '../router/dbx';
import { refSchema } from '../router/store';
import type { Db } from '../types';
import { requireAdmin } from './access';
import { h, parse } from './http';
import { PageParamsSchema } from './schemas';
import { runSql, tbl } from './uc';

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });

/** Path-safe upload name; the .pdf extension is always lower case, whatever case the browser sent. */
export function uploadFileName(originalName: string): string {
  // Multer decodes the name as latin1; restore UTF-8 so Japanese names survive, then make it path safe.
  const original = Buffer.from(originalName, 'latin1').toString('utf8');
  const base = path.basename(original).replace(/[^\p{L}\p{N}._-]+/gu, '_');
  return `${base.replace(/\.pdf$/i, '') || 'upload'}.pdf`;
}

const bool = (v: unknown): boolean => v === true || v === 'true' || v === 't';
const text = (v: unknown): string | null => (v == null ? null : String(v as string));

/** docs_registry joined with section and chunk counts, read from Unity Catalog through the SQL warehouse. */
async function docsFromUc(): Promise<DocInfo[]> {
  const rows = await runSql(`
    SELECT r.doc_id, r.file_name, r.product_code, r.doc_type, r.doc_rev,
           CAST(r.revision_date AS STRING), CAST(r.ingested_at AS STRING), r.is_current,
           COALESCE(s.n, 0), COALESCE(c.n, 0)
      FROM ${tbl('docs_registry')} r
      LEFT JOIN (SELECT doc_id, count(*) AS n FROM ${tbl('if_sections')} GROUP BY doc_id) s USING (doc_id)
      LEFT JOIN (SELECT doc_id, count(*) AS n FROM ${tbl('if_chunks')} GROUP BY doc_id) c USING (doc_id)
     ORDER BY r.ingested_at DESC`);
  return rows.map((r) => ({
    doc_id: String(r[0]),
    file_name: String(r[1] ?? r[0]),
    product_code: r[2],
    doc_type: r[3],
    doc_rev: r[4],
    revision_date: r[5],
    ingested_at: r[6],
    is_current: bool(r[7]),
    section_count: Number(r[8]),
    chunk_count: Number(r[9]),
  }));
}

/** Fallback when the warehouse is unavailable: what the synced if_sections table knows (no chunk counts). */
async function docsFromLakebase(db: Db): Promise<DocInfo[]> {
  const { rows } = await db.query(
    `SELECT s.doc_id, max(r.file_name) AS file_name, max(s.product_code) AS product_code, max(s.doc_rev) AS doc_rev,
            bool_or(s.is_current) AS is_current, count(*)::int AS n
       FROM ${refSchema()}.if_sections s
       LEFT JOIN ${refSchema()}.docs_registry r ON r.doc_id = s.doc_id
      GROUP BY s.doc_id ORDER BY s.doc_id`
  );
  return rows.map((r) => ({
    doc_id: String(r.doc_id),
    file_name: text(r.file_name) ?? String(r.doc_id),
    product_code: text(r.product_code),
    doc_type: 'IF',
    doc_rev: text(r.doc_rev),
    revision_date: null,
    ingested_at: null,
    is_current: Boolean(r.is_current),
    section_count: Number(r.n),
    chunk_count: 0,
  }));
}

/** Page image location. ai_parse_document records it as pages[].image_uri, which beats guessing file names. */
async function pageImagePath(docId: string, page: number): Promise<string | null> {
  const rows = await runSql(
    `SELECT CAST(parsed:document.pages[${page - 1}].image_uri AS STRING)
       FROM ${tbl('parsed_docs')}
      WHERE doc_id = '${docId.replace(/'/g, "''")}' LIMIT 1`
  ).catch(() => []);
  const uri = rows[0]?.[0];
  if (!uri) return null;
  const p = uri.replace(/^dbfs:/, '');
  const root = process.env.PAGE_IMAGES_VOLUME ?? '';
  // Never proxy anything outside the page images volume.
  return root && p.startsWith(`${root}/`) && !p.includes('..') ? p : null;
}

const CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

export function registerDocsEndpoints(app: Application, db: Db): void {
  app.get(
    '/api/v1/docs',
    h(async (_req, res) => {
      let body: DocsResponse;
      try {
        body = { docs: await docsFromUc(), source: 'uc' };
      } catch (err) {
        console.warn('[docs] warehouse query failed, falling back to Lakebase:', (err as Error).message);
        body = { docs: await docsFromLakebase(db), source: 'lakebase' };
      }
      res.json(body);
    })
  );

  app.post(
    '/api/v1/docs/upload',
    requireAdmin,
    upload.single('file'),
    h(async (req, res) => {
      const file = req.file;
      if (!file) throw new HttpError(400, 'multipart field "file" is required');
      if (file.buffer.subarray(0, 5).toString('latin1') !== '%PDF-') {
        throw new HttpError(400, 'only PDF files are accepted');
      }
      const volume = process.env.DOCS_VOLUME;
      if (!volume) throw new HttpError(500, 'DOCS_VOLUME is not set');

      const fileName = uploadFileName(file.originalname);
      const volumePath = `${volume}/${fileName}`;

      const put = await dbxFetch(`/api/2.0/fs/files${encodeURI(volumePath)}?overwrite=true`, {
        method: 'PUT',
        body: new Uint8Array(file.buffer),
        headers: { 'Content-Type': 'application/octet-stream' },
        timeoutMs: 120_000,
      });
      if (!put.ok) throw new HttpError(502, `volume upload failed (${put.status})`);

      const body: UploadResponse = { file_name: fileName, volume_path: volumePath, run_id: null };
      const jobId = Number(process.env.INGEST_JOB_ID);
      if (!jobId) {
        body.warning = 'INGEST_JOB_ID is not set, the file was stored but ingestion was not started';
      } else {
        try {
          const run = await dbxJson<{ run_id: number }>('/api/2.1/jobs/run-now', {
            method: 'POST',
            json: { job_id: jobId },
          });
          body.run_id = run.run_id;
        } catch (err) {
          body.warning = `the file was stored but the ingest job could not be started: ${(err as Error).message}`;
        }
      }
      res.status(201).json(body);
    })
  );

  app.get(
    '/api/v1/docs/:doc_id/pages/:page',
    h(async (req, res) => {
      const { doc_id, page } = parse(PageParamsSchema, req.params);
      const imagePath = await pageImagePath(doc_id, page).catch(() => null);
      if (!imagePath) {
        res.status(404).json({ error: 'page image not available' });
        return;
      }
      const upstream = await dbxFetch(`/api/2.0/fs/files${encodeURI(imagePath)}`, { timeoutMs: 30_000 });
      if (!upstream.ok) {
        res.status(404).json({ error: 'page image not available' });
        return;
      }
      res.setHeader('Content-Type', CONTENT_TYPES[path.extname(imagePath).toLowerCase()] ?? 'application/octet-stream');
      res.setHeader('Cache-Control', 'private, max-age=3600');
      res.send(Buffer.from(await upstream.arrayBuffer()));
    })
  );
}
