import './setup';
import {
  normalizeUsername,
  validateUsername,
  USERNAME_REGEX,
  RESERVED_USERNAMES,
} from '../src/services/userService';
import { BadRequestError } from '../src/utils/errors';

describe('userService - username validation', () => {
  it('normalizes to lowercase and trims', () => {
    expect(normalizeUsername('  Derrick  ')).toBe('derrick');
    expect(normalizeUsername('ALICE_99')).toBe('alice_99');
  });

  it('accepts valid usernames', () => {
    for (const name of ['abc', 'derrick', 'alice_99', 'a_b_c', '123abc', 'a'.repeat(20)]) {
      expect(USERNAME_REGEX.test(name)).toBe(true);
      expect(() => validateUsername(name)).not.toThrow();
    }
  });

  it('rejects invalid usernames', () => {
    const invalid = [
      '',
      'ab',
      'a'.repeat(21),
      'Derrick',
      'has-dash',
      'has space',
      'emoji😀',
      'dot.name',
    ];
    for (const name of invalid) {
      expect(() => validateUsername(name)).toThrow(BadRequestError);
    }
  });

  it('rejects reserved usernames with USERNAME_RESERVED code', () => {
    for (const name of ['app', 'admin', 'paytag', 'send', 'claim']) {
      expect(RESERVED_USERNAMES.has(name)).toBe(true);
      try {
        validateUsername(name);
        fail('expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(BadRequestError);
        expect((err as BadRequestError).errorCode).toBe('USERNAME_RESERVED');
      }
    }
  });

  it('uses USERNAME_INVALID_FORMAT code for malformed input', () => {
    try {
      validateUsername('Has-Dash');
      fail('expected throw');
    } catch (err) {
      expect((err as BadRequestError).errorCode).toBe('USERNAME_INVALID_FORMAT');
    }
  });
});
