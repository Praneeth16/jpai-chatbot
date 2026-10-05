import type { Lang, RouteId } from '../../shared/api';
import { TEMPLATE_BY_ROUTE } from './template-ids';

export interface TemplateRow {
  template_id: string;
  route_id: string;
  lang: string;
  text: string;
  version: number;
  status: string;
}

export interface ResolvedTemplate {
  template_id: string;
  text: string;
  status: string;
}

type Pair = { ja: string; en: string };

// Used only when the synced `templates` table has no row for the route (first start before the sync, local dev).
// Placeholder wording until AZ Medical / Legal / Regulatory approves the real templates.
const FALLBACK: Record<RouteId, Pair> = {
  '0a': { ja: 'メッセージを入力してください。', en: 'Please enter a message.' },
  '0b': {
    ja: 'このご依頼にはお答えできません。医薬品に関するご質問をお寄せください。',
    en: 'I cannot help with that request. Please ask a question about our medicines.',
  },
  '0c_greeting': {
    ja: 'こんにちは。アストラゼネカ製品のインタビューフォームの内容をご案内します。ご質問をどうぞ。',
    en: 'Hello. I can guide you to the interview form content for AstraZeneca products. How can I help?',
  },
  '0c_closing': { ja: 'ご利用ありがとうございました。', en: 'Thank you for using this service.' },
  '0c_about': {
    ja: '私はアストラゼネカ製品のインタビューフォームの該当箇所をご案内するボットです。回答文は生成せず、承認済みの文書をそのまま表示します。',
    en: 'I guide you to the relevant part of the AstraZeneca interview forms. I do not generate answers; I show the approved document text as written.',
  },
  '1': {
    ja: '副作用・有害事象のご報告は、担当MRまたはアストラゼネカの医薬情報窓口までご連絡ください。',
    en: 'Please report side effects and adverse events to your AstraZeneca MR or the AstraZeneca medical information desk.',
  },
  '2': {
    ja: 'このご質問には、こちらでは回答できません。アストラゼネカのメディカルインフォメーションにお問い合わせください。',
    en: 'I cannot answer this question here. Please contact AstraZeneca Medical Information.',
  },
  '3.1': {
    ja: '患者さん向け資料は、製品ページからご覧いただけます。',
    en: 'Patient materials are available on the product page.',
  },
  '3.2': {
    ja: '医療従事者向け資料は、医療関係者向けサイトからご覧いただけます。',
    en: 'Materials for healthcare professionals are available on the HCP website.',
  },
  '4.1': {
    ja: 'インタビューフォームの該当箇所を、そのまま掲載します。',
    en: 'The relevant part of the interview form follows, exactly as written.',
  },
  '4.2': {
    ja: 'インタビューフォームの該当項目を、そのまま掲載します。',
    en: 'The relevant section of the interview form follows, exactly as written.',
  },
  '5.1': {
    ja: '以下は臨床試験に関する情報です。インタビューフォームの該当箇所を、そのまま掲載します。',
    en: 'The following is clinical study information, taken as written from the interview form.',
  },
  '5.2': {
    ja: 'どの臨床試験についてお知りになりたいですか？試験名（例：HIMALAYA）をお知らせください。',
    en: 'Which clinical study do you mean? Please tell me the study name, for example HIMALAYA.',
  },
  '6.1': {
    ja: '医療関係者向けサイトをご利用ください。',
    en: 'Please use the healthcare professional website.',
  },
  '6.2': {
    ja: '担当MRまたはアストラゼネカのメディカルインフォメーションにご連絡ください。',
    en: 'Please contact your AstraZeneca MR or AstraZeneca Medical Information.',
  },
  '7.1': {
    ja: 'どの製品についてのご質問でしょうか？製品名をお知らせください。',
    en: 'Which product is your question about? Please tell me the product name.',
  },
  '8.1': {
    ja: '医薬品に関するご質問をお寄せください。',
    en: 'Please ask a question about our medicines.',
  },
  '8.2': {
    ja: 'こちらは医薬品情報専用の窓口です。その他のご用件は、別の窓口をご利用ください。',
    en: 'This service is only for medicine information. Please use another channel for other matters.',
  },
};

/**
 * CONTRACTS 6.9: templates are returned exactly as stored, no substitution. Lookup is by route_id and lang; an
 * APPROVED row beats a PLACEHOLDER one, then the highest version wins.
 */
export function resolveTemplate(rows: TemplateRow[], route: RouteId, lang: Lang): ResolvedTemplate {
  const candidates = rows
    .filter((r) => r.route_id === route && r.lang === lang)
    .sort((a, b) => Number(b.status === 'APPROVED') - Number(a.status === 'APPROVED') || b.version - a.version);
  const best = candidates[0];
  if (best) return { template_id: best.template_id, text: best.text, status: best.status };
  return { template_id: TEMPLATE_BY_ROUTE[route], text: FALLBACK[route][lang], status: 'FALLBACK' };
}
