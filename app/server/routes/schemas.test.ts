import { describe, expect, it } from 'vitest';
import { DocIdSchema, PageParamsSchema, RouteRequestSchema } from './schemas';

describe('request schemas', () => {
  it('accepts an empty message (CONTRACTS 6.9: routed to 0a, not a 400)', () => {
    expect(RouteRequestSchema.safeParse({ conversation_id: 'c', message: '' }).success).toBe(true);
    expect(RouteRequestSchema.parse({ conversation_id: 'c', message: '  ' })).toMatchObject({
      lang: 'ja',
      audience: 'HCP',
    });
  });
  it('rejects a missing conversation_id, bad lang and bad audience', () => {
    expect(RouteRequestSchema.safeParse({ message: 'x' }).success).toBe(false);
    expect(RouteRequestSchema.safeParse({ conversation_id: '', message: 'x' }).success).toBe(false);
    expect(RouteRequestSchema.safeParse({ conversation_id: 'c', message: 'x', lang: 'fr' }).success).toBe(false);
    expect(RouteRequestSchema.safeParse({ conversation_id: 'c', message: 'x', audience: 'PATIENT' }).success).toBe(
      false
    );
    expect(RouteRequestSchema.safeParse({ conversation_id: 'c' }).success).toBe(false);
  });
  it('keeps doc ids and pages path safe', () => {
    expect(DocIdSchema.safeParse('JD0300_IF').success).toBe(true);
    expect(DocIdSchema.safeParse('イジュド_IF v3').success).toBe(true);
    for (const bad of ['../x', 'a/b', "a'b", 'a;b', '']) expect(DocIdSchema.safeParse(bad).success).toBe(false);
    expect(PageParamsSchema.safeParse({ doc_id: 'a', page: '0' }).success).toBe(false);
    expect(PageParamsSchema.parse({ doc_id: 'a', page: '12' }).page).toBe(12);
  });
});
