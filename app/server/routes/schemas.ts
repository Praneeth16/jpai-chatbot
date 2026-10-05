import { z } from 'zod';

// An empty message is valid input: it is routed to 0a (CONTRACTS 6.9), so no .min(1) here.
export const RouteRequestSchema = z.object({
  conversation_id: z.string().min(1).max(128),
  message: z.string().max(4000),
  lang: z.enum(['ja', 'en']).default('ja'),
  audience: z.literal('HCP').default('HCP'),
});

// Ids come from if_sections.doc_id and end up in volume paths and SQL literals, so keep them to a safe alphabet.
export const DocIdSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[\p{L}\p{N}_.\- ]+$/u)
  .refine((s) => !s.includes('..'), 'invalid doc_id');

export const PageParamsSchema = z.object({
  doc_id: DocIdSchema,
  page: z.coerce.number().int().min(1).max(5000),
});
