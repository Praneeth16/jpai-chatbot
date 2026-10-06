import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, loadConfig, thresholdsOf } from './config';

describe('config', () => {
  it('has the CONTRACTS defaults', () => {
    expect(thresholdsOf(DEFAULT_CONFIG)).toEqual({
      ae: 0.35,
      ae_route: 0.8,
      injection: 0.6,
      has_request: 0.3,
      intent: 0.5,
      conditions: 0.5,
      retrieval: 0,
      title: 0.6,
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
  it('tau_title defaults to 0.6, is overridable and 1.01 switches the title match off', () => {
    expect(DEFAULT_CONFIG.tau_title).toBe(0.6);
    expect(loadConfig('{"tau_title":0.8}').tau_title).toBe(0.8);
    expect(thresholdsOf(loadConfig('{"tau_title":1.01}')).title).toBe(1.01);
    expect(loadConfig('{"tau_title":1.5}')).toEqual(DEFAULT_CONFIG);
  });
  it('ignores a broken ROUTER_CONFIG', () => {
    expect(loadConfig('{nope')).toEqual(DEFAULT_CONFIG);
    expect(loadConfig('{"tau_ae":5}')).toEqual(DEFAULT_CONFIG);
    expect(loadConfig(undefined)).toEqual(DEFAULT_CONFIG);
  });
});
