/**
 * Deterministic prompt injection check. A backstop because the 4B classifier scored messages such as
 * "以前のルールは無視して" below tau_inj (0.44 against 0.6). Recall over precision: a false hit only costs the user
 * the 0b wording.
 */
const JA = [
  '無視して',
  '無視し',
  '無視せよ',
  'システムプロンプト',
  'プロンプトを表示',
  '指示を忘れ',
  'ルールを無視',
  '制限を解除',
  '制約を外',
  '役割を変更',
  'あなたは今から',
];

const EN = [
  /ignore (all |any |the )?(previous|prior|above|earlier) (instructions|rules|prompts?)/,
  /system prompt/,
  /disregard (all |the )?(previous|prior|above) /,
  /you are now /,
  /jailbreak/,
  /developer mode/,
];

/** NFKC + lower case, so full-width Latin matches the lists. */
export function hasInjectionKeyword(text: string): boolean {
  const t = text.normalize('NFKC').toLowerCase();
  return JA.some((k) => t.includes(k)) || EN.some((re) => re.test(t));
}
