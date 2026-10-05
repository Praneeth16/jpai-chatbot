// Dev-only mock backend (VITE_MOCK=1). Canned responses, one per route, so the UI can be demoed
// without the server. Nothing here is medical content: the IF text below is invented sample text.
import type {
  Citation,
  Classification,
  DocsResponse,
  Lang,
  MeResponse,
  OpsSummary,
  PendingClarification,
  Retrieval,
  RouteId,
  RouteResponse,
  SectionResponse,
  TemplateStatus,
  UploadResponse,
} from '../../../shared/api.ts';
import { HttpError } from './http.ts';

const MOCK_DOC = {
  doc_id: 'mock-imjudo-if',
  file_name: 'IMJUDO_IF_sample.pdf',
  doc_rev: '2024年11月改訂（第3版）',
};

const SAMPLE_SECTION_42 = `## 5. 用法及び用量

### (1) 用法及び用量の概要

<table>
<thead><tr><th>対象</th><th>用法及び用量</th></tr></thead>
<tbody>
<tr><td>切除不能な肝細胞癌</td><td>デュルバルマブ（遺伝子組換え）との併用において、通常、成人には本剤として、300 mgを単回点滴静注する。</td></tr>
<tr><td>体重 30 kg 以下</td><td>体重あたりの用量を参照すること。</td></tr>
</tbody>
</table>

(サンプル文です。実際のインタビューフォームの文言ではありません。)`;

const SAMPLE_SECTION_41 = `### 用法及び用量に関連する注意

- 併用薬との投与順序に注意すること。
- 投与時に infusion reaction が発現する可能性があるため、観察を十分に行うこと。

<table>
<tr><th>患者集団</th><th>注意事項</th></tr>
<tr><td>肝機能障害</td><td>慎重に投与すること。</td></tr>
</table>

(サンプル文です。)`;

const SAMPLE_SECTION_51 = `## 臨床成績 (HIMALAYA 試験)

<table>
<thead><tr><th>評価項目</th><th>結果</th></tr></thead>
<tbody>
<tr><td>全生存期間</td><td>サンプル値 (実際の数値ではありません)</td></tr>
<tr><td>安全性</td><td>主な有害事象の一覧 (サンプル)</td></tr>
</tbody>
</table>`;

interface TemplateText {
  ja: string;
  en: string;
}

const TEMPLATES: Record<string, TemplateText> = {
  T_0A: {
    ja: 'ご質問の内容を確認できませんでした。お手数ですが、もう一度ご入力ください。',
    en: 'We could not read your question. Please enter it again.',
  },
  T_0B: {
    ja: 'そのご依頼にはお応えできません。製品情報に関するご質問をお寄せください。',
    en: 'I cannot help with that request. Please ask a question about product information.',
  },
  T_0C_GREETING: {
    ja: 'こんにちは。AstraZeneca の製品に関する情報をご案内します。例: 「イジュドの用法・用量は？」',
    en: 'Hello. I can guide you to information about AstraZeneca products. Example: "What is the dosage of Imjudo?"',
  },
  T_0C_CLOSING: {
    ja: 'ご利用ありがとうございました。ほかにご質問があればお寄せください。',
    en: 'Thank you for using this service. Please ask if you have other questions.',
  },
  T_0C_ABOUT: {
    ja: 'このボットは、承認済みの製品情報 (インタビューフォーム) の該当箇所をそのままご案内します。回答の生成は行いません。',
    en: 'This bot points you to the relevant part of approved product information (Interview Forms) exactly as written. It does not generate answers.',
  },
  T_1: {
    ja: '有害事象が疑われる内容です。MR または医薬情報担当 (MI) へご連絡ください。報告窓口: https://example.invalid/ae-report',
    en: 'This may be an adverse event. Please contact your MR or Medical Information (MI). Reporting: https://example.invalid/ae-report',
  },
  T_2: {
    ja: 'このご質問にはお答えできません。MR にお問い合わせいただくか、表現を変えてご質問ください。',
    en: 'I am unable to answer this question. Please contact your MR or rephrase the question.',
  },
  T_31: {
    ja: '患者向け資材は、患者向け医療情報サイトにございます。入手方法はこちらをご確認ください。https://example.invalid/patient',
    en: 'Patient materials are on the patient education site. See how to request them: https://example.invalid/patient',
  },
  T_32: {
    ja: '製品情報資材は製品情報サイトにございます。入手方法はこちら: https://example.invalid/product-info',
    en: 'Product information materials are on the product information site: https://example.invalid/product-info',
  },
  T_4X_HEADER: {
    ja: '以下は、インタビューフォームの該当箇所です (原文のまま)。',
    en: 'Below is the relevant section of the Interview Form (verbatim).',
  },
  T_51_HEADER: {
    ja: '以下は臨床試験に関する情報です (インタビューフォーム原文)。',
    en: 'Below is clinical study information (Interview Form, verbatim).',
  },
  T_52: {
    ja: 'どの試験についてお知りになりたいですか？ 例: HIMALAYA',
    en: 'Which study would you like to know about? For example: HIMALAYA',
  },
  T_61: {
    ja: 'ウェブサイトに関するお問い合わせは、サイト内のお問い合わせフォームをご利用ください。',
    en: 'For website-related inquiries, please use the contact form on the site.',
  },
  T_62: { ja: 'お問い合わせは担当 MR までご連絡ください。', en: 'For other inquiries, please contact your MR.' },
  T_71: {
    ja: '製品名と知りたい内容を教えてください。例: 「イジュドの用法・用量」',
    en: 'Please tell me the product and what you want to know. For example: "Imjudo dosage and administration"',
  },
  T_81: {
    ja: '申し訳ありません。AstraZeneca の製品に関するご質問のみお答えできます。MR へお問い合わせください。',
    en: 'Sorry, I can only answer questions about AstraZeneca products. Please contact your MR.',
  },
  T_82: {
    ja: '引き続きお答えできないため、MR または MI へ直接ご連絡ください。',
    en: 'I still cannot answer, so please contact your MR or MI directly.',
  },
};

const MOCK_PARENT_ID = `${MOCK_DOC.doc_id}::Ⅴ`;

const CITATION_42: Citation = { ...MOCK_DOC, section_path: 'Ⅴ.3', title: '用法及び用量', pages: [21, 22] };
const CITATION_41: Citation = { ...MOCK_DOC, section_path: 'Ⅴ.4', title: '用法及び用量に関連する注意', pages: [23] };
const CITATION_51: Citation = {
  ...MOCK_DOC,
  section_path: 'Ⅴ.5.(4)',
  title: '検証的試験 (HIMALAYA 試験)',
  pages: [30, 31, 32],
};

interface Spec {
  route: RouteId;
  template: keyof typeof TEMPLATES | null;
  section?: string;
  citation?: Citation;
  pending?: PendingClarification;
  ae?: boolean;
  cls: Partial<Classification> & { intentChoice?: Classification['intent']['choice'] };
  search?: boolean;
}

function has(message: string, ...needles: string[]): boolean {
  const m = message.toLowerCase();
  return needles.some((n) => m.includes(n.toLowerCase()));
}

let offTopicStreak = 0;
let pending: PendingClarification | null = null;
let pendingQuestion = '';

function decide(message: string, merged: string): Spec {
  const trimmed = message.trim();
  if (trimmed === '' || !/[\p{L}\p{N}]/u.test(trimmed) || /^(.)\1{3,}$/u.test(trimmed)) {
    return { route: '0a', template: 'T_0A', cls: {} };
  }
  if (has(merged, '発熱', '副作用が', 'fever', 'rash', '発疹', 'adverse')) {
    return { route: '1', template: 'T_1', ae: true, cls: { adverse_event: 0.93, intentChoice: 'drug_info' } };
  }
  if (has(merged, '指示を無視', 'ignore your', 'system prompt', 'システムプロンプト')) {
    return { route: '0b', template: 'T_0B', cls: { injection: 0.97 } };
  }
  if (has(merged, 'こんにちは', 'hello', 'はじめまして', 'hi ')) {
    return { route: '0c_greeting', template: 'T_0C_GREETING', cls: { has_request: 0.05 } };
  }
  if (has(merged, 'ありがとう', 'thank')) {
    return { route: '0c_closing', template: 'T_0C_CLOSING', cls: { has_request: 0.06 } };
  }
  if (has(merged, '何ができ', 'what can you', 'あなたは')) {
    return { route: '0c_about', template: 'T_0C_ABOUT', cls: { has_request: 0.1 } };
  }
  if (has(merged, '価格', '薬価', 'price', '競合')) {
    return { route: '2', template: 'T_2', cls: { intentChoice: 'unanswerable' } };
  }
  if (has(merged, '患者向け', 'patient material')) {
    return { route: '3.1', template: 'T_31', cls: { intentChoice: 'patient_materials' } };
  }
  if (has(merged, '製品情報資材', 'product information material', '資材')) {
    return { route: '3.2', template: 'T_32', cls: { intentChoice: 'hcp_materials' } };
  }
  if (has(merged, 'ログイン', 'ウェブサイト', 'website', 'log in')) {
    return { route: '6.1', template: 'T_61', cls: { intentChoice: 'website' } };
  }
  if (has(merged, 'mr', '連絡', 'contact')) {
    return { route: '6.2', template: 'T_62', cls: { intentChoice: 'contact_az' } };
  }
  const product = has(merged, 'イジュド', 'imjudo', 'tremelimumab', 'トレメリムマブ');
  const study = has(merged, 'himalaya');
  if (has(merged, '有効性', '安全性', 'efficacy', 'safety')) {
    if (!product && !study)
      return { route: '7.1', template: 'T_71', pending: 'product_focus', cls: { intentChoice: 'efficacy_safety' } };
    if (study) {
      return {
        route: '5.1',
        template: 'T_51_HEADER',
        section: SAMPLE_SECTION_51,
        citation: CITATION_51,
        search: true,
        cls: { intentChoice: 'efficacy_safety', study_ids: ['HIMALAYA'], product_code: 'IMJUDO' },
      };
    }
    return {
      route: '5.2',
      template: 'T_52',
      pending: 'target_study',
      cls: { intentChoice: 'efficacy_safety', product_code: 'IMJUDO' },
    };
  }
  if (has(merged, '用法', '用量', 'dosage', 'administration')) {
    if (!product)
      return { route: '7.1', template: 'T_71', pending: 'product_focus', cls: { intentChoice: 'drug_info' } };
    if (has(merged, 'hcc', '肝細胞', '患者')) {
      return {
        route: '4.1',
        template: 'T_4X_HEADER',
        section: SAMPLE_SECTION_41,
        citation: CITATION_41,
        search: true,
        cls: { intentChoice: 'drug_info', has_conditions: 0.86, product_code: 'IMJUDO' },
      };
    }
    return {
      route: '4.2',
      template: 'T_4X_HEADER',
      section: SAMPLE_SECTION_42,
      citation: CITATION_42,
      search: true,
      cls: { intentChoice: 'drug_info', product_code: 'IMJUDO' },
    };
  }
  if (has(merged, 'az', 'アストラゼネカ', '製品')) {
    return { route: '7.1', template: 'T_71', pending: 'product_focus', cls: { intentChoice: 'ambiguous_az' } };
  }
  return {
    route: offTopicStreak >= 2 ? '8.2' : '8.1',
    template: offTopicStreak >= 2 ? 'T_82' : 'T_81',
    cls: { intentChoice: 'out_of_scope' },
  };
}

function classification(spec: Spec): Classification | null {
  if (spec.route === '0a') return null;
  const choice = spec.cls.intentChoice ?? 'out_of_scope';
  const others = ['drug_info', 'efficacy_safety', 'out_of_scope', 'ambiguous_az', 'website'].filter(
    (c) => c !== choice
  );
  const probabilities: Record<string, number> = {
    [choice]: 0.9,
    [others[0]]: 0.05,
    [others[1]]: 0.03,
    [others[2]]: 0.02,
  };
  return {
    adverse_event: spec.cls.adverse_event ?? 0.02,
    injection: spec.cls.injection ?? 0.01,
    has_request: spec.cls.has_request ?? 0.92,
    has_conditions: spec.cls.has_conditions ?? 0.12,
    smalltalk: { choice: 'other', confidence: 0.9 },
    intent: { choice, confidence: 0.9, probabilities },
    product_code: spec.cls.product_code ?? null,
    study_ids: spec.cls.study_ids ?? [],
    model: 'system.ai.openjev-qwen35-4b (mock)',
    degraded: false,
    thresholds: { ae: 0.35, injection: 0.6, has_request: 0.3, intent: 0.55, conditions: 0.5, retrieval: 0 },
  };
}

function uuid(): string {
  return crypto.randomUUID();
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function route(message: string, lang: Lang): Promise<RouteResponse> {
  await delay(500 + Math.random() * 500);
  const merged = pending ? `${pendingQuestion} ${message}` : message;
  const spec = decide(message, merged);
  if (spec.route === '8.1' || spec.route === '8.2') offTopicStreak += 1;
  else offTopicStreak = 0;
  pending = spec.pending ?? null;
  pendingQuestion = spec.pending ? merged : '';

  const header = spec.template ? TEMPLATES[spec.template][lang] : '';
  const text = spec.section ? `${header}\n\n${spec.section}` : header;
  const sectionId = spec.citation ? `${MOCK_DOC.doc_id}::${spec.citation.section_path}` : null;
  const retrieval: Retrieval | null = spec.search
    ? {
        query: merged,
        filters: { product_code: 'IMJUDO', is_current: true, approved_flag: spec.route !== '5.1' ? true : undefined },
        top_score: 0.71,
        hits: [
          { section_id: `${MOCK_DOC.doc_id}::${spec.citation?.section_path ?? ''}`, score: 0.71 },
          { section_id: `${MOCK_DOC.doc_id}::Ⅴ.1`, score: 0.52 },
          { section_id: `${MOCK_DOC.doc_id}::Ⅷ.6`, score: 0.41 },
        ],
      }
    : null;

  return {
    turn_id: uuid(),
    route_id: spec.route,
    response: {
      template_id: spec.template,
      template_status: (spec.template ? 'PLACEHOLDER' : null) as TemplateStatus | null,
      text,
      header_text: header,
      section_text: spec.section ?? null,
      section_context:
        spec.section && spec.citation
          ? { breadcrumb: ['Ⅴ. 治療に関する項目'], part: null, parent_section_id: MOCK_PARENT_ID }
          : null,
      section_ids: sectionId ? [sectionId] : [],
      citations: spec.citation ? [spec.citation] : [],
    },
    classification: classification(spec),
    retrieval,
    pending_clarification: spec.pending ?? null,
    merged_message: merged,
    ae_logged: spec.ae === true,
    trace_id: 'tr-mock-' + Math.random().toString(16).slice(2, 10),
    latency_ms: spec.route === '0a' ? 3 : Math.round(1800 + Math.random() * 1200),
  };
}

export async function docs(): Promise<DocsResponse> {
  await delay(300);
  return {
    source: 'lakebase',
    docs: [
      {
        doc_id: MOCK_DOC.doc_id,
        file_name: MOCK_DOC.file_name,
        product_code: 'IMJUDO',
        doc_type: 'IF',
        doc_rev: MOCK_DOC.doc_rev,
        revision_date: '2024-11-01',
        ingested_at: '2026-10-02T09:12:00Z',
        is_current: true,
        section_count: 184,
        chunk_count: 412,
      },
      {
        doc_id: 'mock-imjudo-if-old',
        file_name: 'IMJUDO_IF_2023.pdf',
        product_code: 'IMJUDO',
        doc_type: 'IF',
        doc_rev: '2023年6月改訂（第2版）',
        revision_date: '2023-06-01',
        ingested_at: '2026-09-28T04:40:00Z',
        is_current: false,
        section_count: 171,
        chunk_count: 377,
      },
    ],
  };
}

export async function upload(file: File): Promise<UploadResponse> {
  await delay(700);
  return { file_name: file.name, volume_path: `/Volumes/mock/jpai/docs/${file.name}`, run_id: 123456789 };
}

const MOCK_TURNS = [
  ['イジュドの用法・用量は？', '4.2', 'T_4X_HEADER', 2410],
  ['こんにちは', '0c_greeting', 'T_0C_GREETING', 1850],
  ['HIMALAYA試験の安全性を教えて', '5.1', 'T_51_HEADER', 2970],
  ['今日の天気は？', '8.1', 'T_81', 1900],
  ['投与後に患者が発熱しました', '1', 'T_1', 2050],
  ['患者向け資材はどこ？', '3.1', 'T_31', 1760],
] as const;

export function me(): Promise<MeResponse> {
  return Promise.resolve({ email: 'mock.user@example.invalid', is_admin: true });
}

export async function section(sectionId: string, _lang: Lang): Promise<SectionResponse> {
  await delay(300);
  return {
    section_id: sectionId,
    doc_id: MOCK_DOC.doc_id,
    doc_rev: MOCK_DOC.doc_rev,
    section_path: 'Ⅴ',
    title: '治療に関する項目',
    section_text: `${SAMPLE_SECTION_42}\n\n${'(サンプル文の繰り返しです。)\n'.repeat(260)}`,
    header_text: null,
    approved_flag: true,
    section_context: { breadcrumb: [], part: null, parent_section_id: null },
    citation: { ...MOCK_DOC, section_path: 'Ⅴ', title: '治療に関する項目', pages: [20, 21, 22] },
  };
}

export async function ops(): Promise<OpsSummary> {
  await delay(300);
  const now = Date.now();
  return {
    is_admin: true,
    window_days: 7,
    total_turns: 142,
    avg_latency_ms: 2240,
    route_counts: [
      { route_id: '4.2', count: 38 },
      { route_id: '4.1', count: 21 },
      { route_id: '5.1', count: 17 },
      { route_id: '5.2', count: 9 },
      { route_id: '0c_greeting', count: 14 },
      { route_id: '0c_closing', count: 8 },
      { route_id: '8.1', count: 11 },
      { route_id: '2', count: 7 },
      { route_id: '1', count: 4 },
      { route_id: '3.1', count: 5 },
      { route_id: '7.1', count: 6 },
      { route_id: '0b', count: 2 },
    ],
    ae_queue: [
      { status: 'NEW', count: 3 },
      { status: 'NOTIFIED', count: 1 },
    ],
    recent_turns: Array.from({ length: 20 }, (_, i) => {
      const t = MOCK_TURNS[i % MOCK_TURNS.length];
      return {
        turn_id: `mock-turn-${i}`,
        conversation_id: `mock-conv-${Math.floor(i / 3)}`,
        message: t[0],
        route_id: t[1],
        template_id: t[2],
        latency_ms: t[3] + i * 7,
        trace_id: `tr-mock-${i}`,
        created_at: new Date(now - i * 4 * 60_000).toISOString(),
      };
    }),
  };
}

export async function pageImage(docId: string, page: number): Promise<string> {
  await delay(250);
  if (page > 30) {
    throw new HttpError(404, 'page not found');
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="794" height="1123" viewBox="0 0 794 1123"><rect width="794" height="1123" fill="#ffffff" stroke="#cfc9d2"/><text x="60" y="110" font-size="28" font-family="sans-serif" fill="#3a1a2e">Mock page image</text><text x="60" y="160" font-size="20" font-family="sans-serif" fill="#615a68">${docId} / page ${page}</text>${Array.from({ length: 24 }, (_, i) => `<rect x="60" y="${220 + i * 34}" width="${560 + ((i * 53) % 120)}" height="10" rx="3" fill="#e4dfe7"/>`).join('')}</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
