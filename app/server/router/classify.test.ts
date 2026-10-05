import { describe, expect, it, vi } from 'vitest';
import { buildRequest, classify, parseResponse } from './classify';
import { QUESTIONS } from './questions';

const ok = {
  model: 'system.ai.openjev-qwen35-4b',
  answers: {
    adverse_event: { type: 'noul', noul: 0.93 },
    injection: { type: 'noul', noul: 0.01 },
    has_request: { type: 'noul', noul: 0.2 },
    has_conditions: { type: 'noul', noul: 0.1 },
    smalltalk: { type: 'choice', choice: 'closing', confidence: 0.9, probabilities: { closing: 0.9, other: 0.1 } },
    intent: { type: 'choice', choice: 'report_ae', confidence: 0.8, probabilities: { report_ae: 0.8 } },
  },
};
const input = { message: 'ありがとう', recent_turns: [], pending_clarification: null };

describe('questions', () => {
  it('defines every System One question of CONTRACTS section 6 step 3', () => {
    expect(Object.keys(QUESTIONS)).toEqual([
      'adverse_event',
      'injection',
      'has_request',
      'has_conditions',
      'smalltalk',
      'intent',
    ]);
    expect(Object.keys(QUESTIONS.intent.criteria)).toEqual([
      'unanswerable',
      'patient_materials',
      'hcp_materials',
      'drug_info',
      'efficacy_safety',
      'website',
      'contact_az',
      'ambiguous_az',
      'report_ae',
      'out_of_scope',
    ]);
    expect(Object.keys(QUESTIONS.smalltalk.criteria)).toEqual(['greeting', 'closing', 'about_bot', 'other']);
    for (const q of Object.values(QUESTIONS)) {
      expect(q.instructions).toMatch(/[ぁ-んァ-ン一-龥]/u); // Japanese
      expect(q.instructions).toMatch(/[A-Za-z]{4}/); // English
    }
  });
});

describe('classify', () => {
  it('builds the gateway request body', () => {
    const body = buildRequest(input, 'm') as Record<string, unknown>;
    expect(body).toMatchObject({
      model: 'm',
      state: { current_message: 'ありがとう', recent_turns: [], pending_clarification: null },
    });
    expect(body.questions).toBe(QUESTIONS);
  });

  it('parses a System One answer and records the model id', () => {
    expect(parseResponse(ok)).toMatchObject({
      adverse_event: 0.93,
      has_request: 0.2,
      smalltalk: { choice: 'closing', confidence: 0.9 },
      intent: { choice: 'report_ae', confidence: 0.8 },
      model: 'system.ai.openjev-qwen35-4b',
      degraded: false,
    });
  });

  it('retries once and then succeeds', async () => {
    const post = vi.fn().mockRejectedValueOnce(new Error('503')).mockResolvedValueOnce(ok);
    const r = await classify(input, post, 'm');
    expect(post).toHaveBeenCalledTimes(2);
    expect(r.degraded).toBe(false);
  });

  it('never throws: two failures give the safe classification that routes to 2', async () => {
    const post = vi.fn().mockRejectedValue(new Error('down'));
    const r = await classify(input, post, 'm');
    expect(post).toHaveBeenCalledTimes(2);
    expect(r).toMatchObject({ degraded: true, adverse_event: 0, intent: { choice: 'unanswerable', confidence: 1 } });
  });

  it('a malformed answer counts as a failure', async () => {
    const post = vi.fn().mockResolvedValue({ answers: { intent: { choice: 'x', confidence: 1 } } });
    expect((await classify(input, post, 'm')).degraded).toBe(true);
  });

  it('an unknown intent option is rejected', () => {
    const bad = structuredClone(ok);
    bad.answers.intent.choice = 'made_up';
    expect(() => parseResponse(bad)).toThrow();
  });

  it('without a model name it does not call the gateway', async () => {
    const post = vi.fn();
    expect((await classify(input, post, undefined)).degraded).toBe(true);
    expect(post).not.toHaveBeenCalled();
  });
});
