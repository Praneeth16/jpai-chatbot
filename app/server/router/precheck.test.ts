import { describe, expect, it } from 'vitest';
import { precheck } from './precheck';

describe('precheck (route 0a)', () => {
  it.each([
    ['', 'empty'],
    ['   \n\t', 'empty'],
    ['12345', 'no_letters'],
    ['!!! ???', 'no_letters'],
    ['。。。', 'no_letters'],
    ['aaaaaa', 'repeated_char'],
    ['ああああ', 'repeated_char'],
    ['ｗｗｗ', 'repeated_char'],
    ['w w w', 'repeated_char'],
  ])('rejects %j', (message, reason) => {
    expect(precheck(message)).toEqual({ ok: false, reason });
  });

  it.each(['HIMALAYA', 'あ', 'OK', 'イジュド', '用法は？', 'ab', 'aab'])('accepts %j (no length rejection)', (m) => {
    expect(precheck(m).ok).toBe(true);
  });
});
