import { describe, expect, it } from 'vitest';
import { isInvalidOnchainSegment } from './routing';

describe('isInvalidOnchainSegment', () => {
  it.each(['derrick', 'Derrick', '%40derrick', 'abc', 'a_b_1', 'x'.repeat(20)])('lets %s through', (s) => {
    expect(isInvalidOnchainSegment(s)).toBe(false);
  });

  it('never flags static sub-routes', () => {
    expect(isInvalidOnchainSegment('my-names')).toBe(false);
  });

  it.each(['BAD-NAME', 'ab', 'x'.repeat(21), 'bad.name', '%E0%A4', '%D0%B0bc', 'with%20space'])('flags %s', (s) => {
    expect(isInvalidOnchainSegment(s)).toBe(true);
  });
});
