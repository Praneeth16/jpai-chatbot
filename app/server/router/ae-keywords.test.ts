import { describe, expect, it } from 'vitest';
import { hasAeKeyword } from './ae-keywords';

describe('hasAeKeyword', () => {
  it.each([
    '先日の患者さんで副作用が出ました',
    'イジュド投与後に発熱しました',
    '発疹が発現した',
    '患者が下痢を訴え、入院しました',
    '投与して3日後に死亡',
    'ありがとう。ところで患者が重篤な肝障害でした',
    'A patient developed a rash after the dose',
    'Is this a side effect?',
    'adverse reaction reported',
    'fever and diarrhea since infusion',
    'the patient was hospitalized',
    'ＦＥＶＥＲ', // full-width
    'ｱﾅﾌｨﾗｷｼｰが疑われます', // half-width katakana
  ])('flags %j', (m) => {
    expect(hasAeKeyword(m)).toBe(true);
  });

  it.each([
    'イジュドの用法用量を教えてください',
    'What is the storage temperature of Imjudo?',
    'こんにちは',
    '今日の天気は',
  ])('does not flag %j', (m) => {
    expect(hasAeKeyword(m)).toBe(false);
  });
});
