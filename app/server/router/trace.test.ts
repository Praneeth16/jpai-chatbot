import { describe, expect, it } from 'vitest';
import { mlflowTracer, noopTracer, noopTurnTrace } from './trace';

describe('trace', () => {
  it('the no-op trace runs the function and returns its result', async () => {
    expect(await noopTurnTrace.span('x', {}, () => 42)).toBe(42);
    expect(noopTurnTrace.traceId()).toBeNull();
    expect(() => noopTurnTrace.tag({ a: 'b' })).not.toThrow();
    expect(
      await noopTracer.turn({ conversation_id: 'c', turn_id: 't', message: 'm' }, () => Promise.resolve('ok'))
    ).toBe('ok');
  });

  it('without initTracing the MLflow tracer is a pass-through and keeps errors from the turn', async () => {
    const meta = { conversation_id: 'c', turn_id: 't', message: 'm' };
    expect(await mlflowTracer.turn(meta, async (t) => t.span('s', {}, () => 'v'))).toBe('v');
    await expect(mlflowTracer.turn(meta, () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
  });
});
