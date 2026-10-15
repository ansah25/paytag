import { describe, expect, it } from 'vitest';
import { USERNAME_PATTERN, normalizeUsername, sanitizeNameInput } from './username';

// Escapes, not literal characters: these look identical to ASCII in an editor.
const KELVIN = 'K'; // KELVIN SIGN, lowercases to ASCII "k" under String#toLowerCase
const IDEOGRAPHIC_SPACE = '　';
const ZWNBSP = '﻿';
const NBSP = ' ';
const CAPITAL_I_DOT = 'İ'; // lowercases to "i" + combining dot

const valid = (raw: string) => USERNAME_PATTERN.test(normalizeUsername(raw));

describe('normalizeUsername', () => {
  it('trims ASCII whitespace, drops a leading @ and lowercases ASCII', () => {
    expect(normalizeUsername('  @Derrick_1 ')).toBe('derrick_1');
    expect(normalizeUsername('\tKATE\n')).toBe('kate');
  });

  it('never folds non-ASCII into ASCII', () => {
    expect(normalizeUsername(`${KELVIN}ate`)).toBe(`${KELVIN}ate`);
    expect(valid(`${KELVIN}ate`)).toBe(false);
    expect(valid(`${CAPITAL_I_DOT}nan`)).toBe(false);
  });

  it('leaves Unicode whitespace for the pattern to reject', () => {
    expect(valid(`${IDEOGRAPHIC_SPACE}kate`)).toBe(false);
    expect(valid(`kate${ZWNBSP}`)).toBe(false);
    expect(valid(`${NBSP}kate`)).toBe(false);
  });
});

describe('sanitizeNameInput', () => {
  it('removes ASCII whitespace anywhere, drops a leading @ and lowercases ASCII', () => {
    expect(sanitizeNameInput('@De rrick\t')).toBe('derrick');
  });

  it('keeps non-ASCII visible instead of folding it into another name', () => {
    expect(sanitizeNameInput(`${KELVIN}ate`)).toBe(`${KELVIN}ate`);
    expect(sanitizeNameInput(`kate${NBSP}`)).toBe(`kate${NBSP}`);
    expect(USERNAME_PATTERN.test(sanitizeNameInput(`${KELVIN}ate`))).toBe(false);
  });
});
