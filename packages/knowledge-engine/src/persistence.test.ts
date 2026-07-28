import { describe, expect, it } from 'vitest';
import { personNamesMatch } from './persistence.js';

describe('personNamesMatch', () => {
  it('matches a bare first name with a full name', () => {
    expect(personNamesMatch('Krish', 'Krish Modi')).toBe(true);
    expect(personNamesMatch('Shibaditya Deb', 'Shibaditya')).toBe(true);
  });
  it('does not match different last names sharing a first name', () => {
    expect(personNamesMatch('Krish Modi', 'Krish Kumar')).toBe(false);
  });
  it('does not match different first names', () => {
    expect(personNamesMatch('Ayush Kumar', 'Aayush Dutt')).toBe(false);
    expect(personNamesMatch('Krish', 'Kamal')).toBe(false);
  });
  it('is case/space tolerant', () => {
    expect(personNamesMatch('  krish   modi ', 'Krish Modi')).toBe(true);
  });
  it('returns false for empty names', () => {
    expect(personNamesMatch('', 'Krish')).toBe(false);
  });
});
