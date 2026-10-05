import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, loadConfig, thresholdsOf } from './config';

describe('config', () => {
  it('has the CONTRACTS defaults', () => {
    expect(thresholdsOf(DEFAULT_CONFIG)).toEqual({
      ae: 0.35,
      injection: 0.6,
      has_request: 0.3,
      intent: 0.55,
      conditions: 0.5,
      retrieval: 0,
    });
    expect(DEFAULT_CONFIG.off_topic_streak).toBe(3);
    expect(DEFAULT_CONFIG.num_results).toBe(8);
    expect(DEFAULT_CONFIG.max_verbatim_chars).toBe(8000);
    expect(DEFAULT_CONFIG.require_qa_approved).toBe(false);
  });
  it('is overridable with ROUTER_CONFIG', () => {
    expect(loadConfig('{"tau_ret":0.4,"tau_ae":0.2}')).toMatchObject({ tau_ret: 0.4, tau_ae: 0.2, tau_inj: 0.6 });
  });
  it('accepts the real keys documented in .env.example', () => {
    expect(loadConfig('{"tau_intent":0.5,"max_verbatim_chars":6000,"require_qa_approved":true}')).toMatchObject({
      tau_intent: 0.5,
      max_verbatim_chars: 6000,
      require_qa_approved: true,
    });
  });
  it('ignores a broken ROUTER_CONFIG', () => {
    expect(loadConfig('{nope')).toEqual(DEFAULT_CONFIG);
    expect(loadConfig('{"tau_ae":5}')).toEqual(DEFAULT_CONFIG);
    expect(loadConfig(undefined)).toEqual(DEFAULT_CONFIG);
  });
});
