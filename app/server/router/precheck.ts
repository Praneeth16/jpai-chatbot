export type PrecheckReason = 'empty' | 'no_letters' | 'repeated_char';

export interface PrecheckResult {
  ok: boolean;
  reason: PrecheckReason | null;
}

/**
 * Route 0a code check (CONTRACTS section 6 step 2). No length rejection: a one word reply such as "HIMALAYA"
 * must pass. Letters include kana and kanji (Unicode \p{L}).
 */
export function precheck(message: string): PrecheckResult {
  const trimmed = message.normalize('NFKC').trim();
  if (trimmed.length === 0) return { ok: false, reason: 'empty' };
  if (!/\p{L}/u.test(trimmed)) return { ok: false, reason: 'no_letters' };
  const chars = [...trimmed.replace(/\s+/gu, '')];
  if (chars.length >= 3 && chars.every((c) => c === chars[0])) {
    return { ok: false, reason: 'repeated_char' };
  }
  return { ok: true, reason: null };
}
