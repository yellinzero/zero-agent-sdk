import { describe, expect, it } from 'vitest';
import { parsePartialJson } from '../utils/partial-json.js';

function isStructuralSubset(parsed: unknown, full: unknown): boolean {
  if (parsed === undefined) return true;
  if (parsed === null || full === null) return parsed === full;
  if (Array.isArray(parsed)) {
    return (
      Array.isArray(full) &&
      parsed.length <= full.length &&
      parsed.every((item, index) => isStructuralSubset(item, full[index]))
    );
  }
  if (typeof parsed === 'object') {
    if (!full || typeof full !== 'object' || Array.isArray(full)) return false;
    return Object.entries(parsed as Record<string, unknown>).every(([key, value]) =>
      isStructuralSubset(value, (full as Record<string, unknown>)[key])
    );
  }
  return Object.is(parsed, full);
}

describe('parsePartialJson', () => {
  it('repairs truncated unicode escape sequences', () => {
    expect(parsePartialJson('{"value":"\\u4f"}')).toBeUndefined();
    expect(parsePartialJson('{"value":"\\u4f60"}')).toEqual({ value: '你' });
  });

  it('drops truncated numbers instead of throwing', () => {
    expect(parsePartialJson('{"value":12.')).toEqual({});
    expect(parsePartialJson('{"value":12e')).toEqual({});
    expect(parsePartialJson('{"value":12e+')).toEqual({});
  });

  it('extracts the valid JSON prefix from mixed text', () => {
    expect(parsePartialJson('preface {"value":1,"ok":true} suffix')).toEqual({
      value: 1,
      ok: true,
    });
  });

  it('handles escaped quotes correctly', () => {
    expect(parsePartialJson('{"value":"a\\\\\\"b"}')).toEqual({ value: 'a\\"b' });
  });

  it('matches the complete JSON value on valid prefixes', () => {
    const full = '{"items":[{"id":1},{"id":2}],"ok":true}';
    const fullValue = JSON.parse(full);
    for (let i = 1; i <= full.length; i++) {
      const prefix = full.slice(0, i);
      const parsed = parsePartialJson(prefix);
      if (prefix === full) {
        expect(parsed).toEqual(fullValue);
      } else {
        expect(isStructuralSubset(parsed, fullValue)).toBe(true);
      }
    }
  });

  it('preserves the complete JSON slice inside mixed prose', () => {
    const text = 'preface\n{"items":[1,2,3],"ok":true}\nsuffix';
    expect(parsePartialJson(text)).toEqual({ items: [1, 2, 3], ok: true });
  });

  it('survives fuzzed truncation cases', () => {
    const seeds = [
      '{"a":1,"b":[1,2,3],"c":{"d":"x"}}',
      '{"emoji":"\\u4f60\\u597d","nested":{"ok":true}}',
      '{"arr":[{"id":1},{"id":2},{"id":3}]}',
      '{"num":-12.34e+5,"flag":false}',
      '{"text":"quote: \\"hello\\""}',
    ];

    let cases = 0;
    for (const seed of seeds) {
      for (let i = 1; i <= seed.length; i++) {
        const slice = seed.slice(0, i);
        const fullValue = JSON.parse(seed);
        const parsed = parsePartialJson(slice);
        expect(isStructuralSubset(parsed, fullValue)).toBe(true);
        cases++;
      }
    }

    expect(cases).toBeGreaterThanOrEqual(50);
  });

  it('handles deeper nesting and surrogate pairs', () => {
    expect(
      parsePartialJson(
        '{"outer":{"mid":{"inner":{"emoji":"\\ud83d\\ude00","items":[{"id":1},{"id":2}]}}}}'
      )
    ).toEqual({
      outer: { mid: { inner: { emoji: '😀', items: [{ id: 1 }, { id: 2 }] } } },
    });
  });

  it('extracts nested JSON from prose with earlier braces', () => {
    expect(
      parsePartialJson('note: {not json} before payload {"value":1,"nested":{"ok":true}} trailing')
    ).toEqual({
      value: 1,
      nested: { ok: true },
    });
  });

  it('keeps large numbers and negative zero when complete', () => {
    const unsafe = Number('9007199254740993');
    expect(parsePartialJson('{"big":1e308,"negZero":-0,"unsafe":9007199254740993}')).toEqual({
      big: 1e308,
      negZero: -0,
      unsafe,
    });
  });
});
