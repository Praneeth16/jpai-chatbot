// Test helpers shared by the router unit tests. Not imported by production code.
import type { MasterData } from './masterdata';
import { safeClassification } from './classify';
import { DEFAULT_CONFIG, type RouterConfig } from './config';
import type { SectionMeta } from './flow';
import type { RawClassification } from './types';
import { type ConversationState, emptyState } from './types';
import type { DecideInput } from './types';
import { matchMasterData } from './masterdata';
import { mergeClarification } from './merge';
import { precheck } from './precheck';

export const MASTER: MasterData = {
  products: [
    {
      product_code: 'IMJUDO',
      brand_ja: 'イジュド',
      brand_en: 'Imjudo',
      generic_ja: 'トレメリムマブ',
      generic_en: 'tremelimumab',
      patient_materials_url: null,
      product_info_url: null,
    },
    {
      product_code: 'IMFINZI',
      brand_ja: 'イミフィンジ',
      brand_en: 'Imfinzi',
      generic_ja: 'デュルバルマブ',
      generic_en: 'durvalumab',
      patient_materials_url: null,
      product_info_url: null,
    },
  ],
  // Same shape as data/reference/studies.csv and synonyms.csv (POSEIDON lists both products; NSCLC names three studies).
  studies: [
    { study_id: 'HIMALAYA', study_code: 'D419CC00002', product_codes: ['IMJUDO', 'IMFINZI'] },
    { study_id: 'POSEIDON', study_code: 'D419MC00004', product_codes: ['IMJUDO', 'IMFINZI'] },
    { study_id: 'PACIFIC', study_code: 'D4191C00001', product_codes: ['IMFINZI'] },
    { study_id: 'AEGEAN', study_code: 'D9106C00001', product_codes: ['IMFINZI'] },
    { study_id: 'TOPAZ-1', study_code: 'D933AC00001', product_codes: ['IMFINZI'] },
  ],
  synonyms: [
    { term: 'ヒマラヤ試験', kind: 'study', target_id: 'HIMALAYA' },
    { term: '肝細胞癌', kind: 'indication', target_id: 'HIMALAYA' },
    { term: 'hcc', kind: 'indication', target_id: 'HIMALAYA' },
    { term: '非小細胞肺癌', kind: 'indication', target_id: 'POSEIDON' },
    { term: '非小細胞肺癌', kind: 'indication', target_id: 'PACIFIC' },
    { term: '非小細胞肺癌', kind: 'indication', target_id: 'AEGEAN' },
    { term: 'nsclc', kind: 'indication', target_id: 'POSEIDON' },
    { term: 'nsclc', kind: 'indication', target_id: 'PACIFIC' },
    { term: 'nsclc', kind: 'indication', target_id: 'AEGEAN' },
    { term: '胆道癌', kind: 'indication', target_id: 'TOPAZ-1' },
  ],
};

export function cls(over: Partial<RawClassification> = {}): RawClassification {
  return {
    ...safeClassification('system.ai.test'),
    degraded: false,
    has_request: 0.9,
    smalltalk: { choice: 'other', confidence: 0.9 },
    intent: { choice: 'drug_info', confidence: 0.9, probabilities: {} },
    ...over,
  };
}

export const intent = (choice: RawClassification['intent']['choice'], confidence = 0.9): RawClassification =>
  cls({ intent: { choice, confidence, probabilities: {} } });

export function input(
  message: string,
  classification: RawClassification,
  state: ConversationState = emptyState('c1'),
  over: Partial<DecideInput> = {}
): DecideInput {
  const merge = mergeClarification(state, message);
  return {
    message,
    merged_message: merge.merged,
    is_clarification: merge.is_clarification,
    precheck_ok: precheck(message).ok,
    classification,
    masterdata: matchMasterData(merge.merged, MASTER),
    state,
    audience: 'HCP',
    ...over,
  };
}

export const config = (over: Partial<RouterConfig> = {}): RouterConfig => ({ ...DEFAULT_CONFIG, ...over });

/** Lineage row with safe defaults: current, not rejected, approved, small. */
export const sec = (
  section_id: string,
  level: number,
  parent_section_id: string | null,
  over: Partial<SectionMeta> = {}
): SectionMeta => ({
  section_id,
  section_path: section_id.replace(/^d::/, ''),
  level,
  parent_section_id,
  char_len: 1000,
  is_current: true,
  qa_status: 'AUTO',
  approved_flag: true,
  ...over,
});

export const SECTIONS: SectionMeta[] = [
  sec('d::Ⅳ', 1, null),
  sec('d::Ⅳ.1', 2, 'd::Ⅳ'),
  sec('d::Ⅳ.1.(1)', 3, 'd::Ⅳ.1'),
  sec('d::Ⅴ', 1, null),
  sec('d::Ⅴ.3', 2, 'd::Ⅴ'),
  sec('d::Ⅴ.3.(2)', 3, 'd::Ⅴ.3'),
  sec('d::Ⅴ.5', 2, 'd::Ⅴ', { approved_flag: false }),
];
