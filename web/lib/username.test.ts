import { describe, expect, it } from 'vitest';
import { USERNAME_PATTERN, normalizeUsername } from './username';

const valid = (raw: string) => USERNAME_PATTERN.test(normalizeUsername(raw));

describe('normalizeUsername', () => {
  it('trims ASCII whitespace, drops a leading @ and lowercases ASCII', () => {
    expect(normalizeUsername('  @Derrick_1 ')).toBe('derrick_1');
    expect(normalizeUsername('\tKATE\n')).toBe('kate');
  });

  it('never folds non-ASCII into ASCII (Kelvin sign U+212A is not "k")', () => {
    expect(normalizeUsername('Kate')).toBe('Kate');
    expect(valid('Kate')).toBe(false);
    expect(valid('İnan')).toBe(false); // U+0130 lowercases to "i" + combining dot
  });

  it('leaves Unicode whitespace for the pattern to reject', () => {
    expect(valid('　kate')).toBe(false); // ideographic space
    expect(valid('kate﻿')).toBe(false); // zero-width no-break space
    expect(valid(' kate')).toBe(false); // no-break space
  });
});
