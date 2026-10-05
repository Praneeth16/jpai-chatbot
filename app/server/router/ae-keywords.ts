/**
 * Deterministic adverse event keyword check (CONTRACTS section 8). It runs only when System One is unavailable, so a
 * possible AE report is never silently lost. Recall over precision: a false hit only costs a human a glance.
 */
const JA = [
  '副作用',
  '有害事象',
  '有害反応',
  '副反応',
  '発現',
  '発症',
  '発熱',
  '発疹',
  '湿疹',
  '蕁麻疹',
  '下痢',
  '嘔吐',
  '吐き気',
  '悪心',
  '倦怠感',
  '肝障害',
  '肝機能障害',
  '間質性肺',
  '肺炎',
  '大腸炎',
  '心筋炎',
  '甲状腺機能',
  '副腎機能',
  'アナフィラキシー',
  'ショック',
  '意識障害',
  '痙攣',
  'けいれん',
  '投与後',
  '投与中',
  '投与して',
  '死亡',
  '亡くな',
  '入院',
  '重篤',
  '救急',
  '症状が',
  'インフュージョン',
  '過量投与',
];

const EN = [
  /\bside[- ]?effects?\b/,
  /\badverse\b/,
  /\breactions?\b/,
  /\brash(es)?\b/,
  /\bfever\b/,
  /\bdiarrh?o?ea\b/,
  /\b(vomit|vomiting|nausea)\b/,
  /\bhospitali[sz](ed|ation)\b/,
  /\b(died|death|fatal|deceased)\b/,
  /\b(anaphyla\w*|pneumonitis|colitis|hepatitis|myocarditis|hepatotoxicity)\b/,
  /\bafter (the |a |an |his |her )?(dose|dosing|infusion|injection|administration|taking)\b/,
  /\b(post[- ]dose|overdose|life[- ]threatening|serious event)\b/,
  /\bpatient (developed|experienced|suffered|had)\b/,
];

/** NFKC + lower case, so full-width Latin and half-width katakana match the lists. */
export function hasAeKeyword(text: string): boolean {
  const t = text.normalize('NFKC').toLowerCase();
  return JA.some((k) => t.includes(k)) || EN.some((re) => re.test(t));
}
