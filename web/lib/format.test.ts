import { describe, expect, it } from 'vitest';
import { splitAddress } from './format';

describe('splitAddress', () => {
  // The pay review renders head + mid + tail, so the full address is always shown.
  it.each([
    '0x6aD631F215393f9635231de985081B1ccDDC7C11',
    'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
    '4Nd1mYz7K8jM2QpRzWxV3Y5tF7gH9JkLm2NoP4Qr5SsT',
    'short',
  ])('recomposes %s exactly', (address) => {
    const { head, mid, tail } = splitAddress(address);
    expect(head + mid + tail).toBe(address);
  });
});
