import type { Application } from 'express';
import { z } from 'zod';
import type { SectionResponse } from '../../shared/api';
import { HttpError } from '../errors';
import { isAnswerable } from '../router/flow';
import { citationFor, contextOf, type Deps } from '../router/orchestrator';
import { resolveTemplate } from '../router/templates';
import { h, parse } from './http';

const SectionParamsSchema = z.object({ section_id: z.string().min(1).max(600) });
const SectionQuerySchema = z.object({ lang: z.enum(['ja', 'en']).default('ja') });

/**
 * GET /api/v1/sections/:section_id, the verbatim section behind "show full parent section". It applies the same
 * answer rules as the router (CONTRACTS section 8): no FRONT or chapter level, current, not REJECTED, and no
 * approved section that contains unapproved sub-sections. Unapproved sections (clinical results) are returned
 * with the 5.1 header, as route 5.1 would.
 */
export function registerSectionsEndpoint(app: Application, deps: Deps): void {
  const { store, config } = deps;
  app.get(
    '/api/v1/sections/:section_id',
    h(async (req, res) => {
      const { section_id } = parse(SectionParamsSchema, req.params);
      const { lang } = parse(SectionQuerySchema, req.query);

      let found;
      try {
        found = await store.section(section_id);
      } catch (err) {
        console.error('[sections] lookup failed:', (err as Error).message);
        throw new HttpError(503, 'reference data is temporarily unavailable');
      }
      if (!found || !isAnswerable(found, false, config)) throw new HttpError(404, 'section not available');

      if (found.approved_flag) {
        const unapprovedChild = await store.subtreeUnapproved(found.section_id).catch((err: unknown) => {
          console.error('[sections] subtree check failed:', (err as Error).message);
          throw new HttpError(503, 'reference data is temporarily unavailable');
        });
        if (unapprovedChild) throw new HttpError(403, 'section contains sub-sections that are not approved');
      }

      const [crumbs, fileName, templates] = await Promise.all([
        store.breadcrumb(found.section_id).catch(() => [] as string[]),
        store.fileName(found.doc_id).catch(() => found.doc_id),
        store.templates().catch(() => []),
      ]);
      const body: SectionResponse = {
        section_id: found.section_id,
        doc_id: found.doc_id,
        doc_rev: found.doc_rev,
        section_path: found.section_path,
        title: found.title,
        section_text: found.markdown,
        header_text: found.approved_flag ? null : resolveTemplate(templates, '5.1', lang).text,
        approved_flag: found.approved_flag,
        section_context: contextOf(found, crumbs),
        citation: citationFor(found, fileName),
      };
      res.json(body);
    })
  );
}
