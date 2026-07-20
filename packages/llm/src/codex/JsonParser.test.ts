import { describe, expect, it } from 'vitest';
import { JsonParseError } from './errors.js';
import { parseJson } from './JsonParser.js';

describe('parseJson', () => {
  it('parses plain JSON', () => {
    expect(parseJson('{"a":1}')).toEqual({ a: 1 });
  });

  it('strips ```json code fences', () => {
    const raw = 'Here you go:\n```json\n{"ok":true}\n```\nThanks!';
    expect(parseJson(raw)).toEqual({ ok: true });
  });

  it('extracts JSON embedded in prose', () => {
    expect(parseJson('The result is {"n": 42} as requested.')).toEqual({ n: 42 });
  });

  it('handles nested objects with braces inside strings', () => {
    const raw = '{"text":"a } b { c","v":[1,2]}';
    expect(parseJson(raw)).toEqual({ text: 'a } b { c', v: [1, 2] });
  });

  it('repairs trailing commas and smart quotes', () => {
    const raw = '{ “key”: “value”, "list": [1, 2,], }';
    expect(parseJson(raw)).toEqual({ key: 'value', list: [1, 2] });
  });

  it('parses top-level arrays', () => {
    expect(parseJson('[{"a":1},{"b":2}]')).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('throws JsonParseError on empty input', () => {
    expect(() => parseJson('   ')).toThrow(JsonParseError);
  });

  it('throws JsonParseError when no JSON is present', () => {
    expect(() => parseJson('no json here')).toThrow(JsonParseError);
  });

  it('marks parse errors as retryable', () => {
    try {
      parseJson('definitely not json');
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(JsonParseError);
      expect((error as JsonParseError).retryable).toBe(true);
    }
  });
});
