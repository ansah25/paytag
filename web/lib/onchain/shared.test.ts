import { describe, expect, it } from 'vitest';
import type { Hex } from 'viem';
import vectors from '../../../indexer/test/vectors.json';
import { decodeAddress, encodeAddress } from './generated/codec';
import { REGISTRY_ADDRESS, RESOLVER_ADDRESS } from './generated/deployment';
import { normalizeName } from './generated/names';
import { RESERVED_NODES } from './generated/reservedNodes';
import { buildWrite } from './useOnchainTx';

// The generated copies must behave exactly like the indexer's originals: same vectors, same
// verdicts. (indexer/scripts/export-abis.mjs --check guards that the files are identical.)
describe('shared codec vectors', () => {
  it.each(vectors.valid)('$label round-trips', ({ coinType, address, value }) => {
    expect(encodeAddress(BigInt(coinType), address)).toBe(value);
    expect(decodeAddress(BigInt(coinType), value as Hex)).toBe(address);
  });

  it.each(vectors.invalidAddresses)('rejects $label', ({ coinType, address }) => {
    expect(() => encodeAddress(BigInt(coinType), address)).toThrow();
  });
});

describe('names and reserved list', () => {
  it('normalizes like the registry and knows the reserved names', () => {
    const r = normalizeName('@PayTag');
    expect(r.ok).toBe(true);
    if (r.ok) expect(RESERVED_NODES.has(r.node)).toBe(true);
    expect(RESERVED_NODES.size).toBe(28);
  });
});

describe('buildWrite', () => {
  const node = ('0x' + '11'.repeat(32)) as Hex;

  it('targets the right contract and function for each write', () => {
    const secret = ('0x' + '33'.repeat(32)) as Hex;
    expect(buildWrite({ kind: 'commit', commitment: node })).toMatchObject({
      address: REGISTRY_ADDRESS,
      functionName: 'commit',
      args: [node],
    });
    expect(buildWrite({ kind: 'register', name: 'derrick', secret })).toMatchObject({
      address: REGISTRY_ADDRESS,
      functionName: 'register',
      args: ['derrick', secret],
    });
    expect(buildWrite({ kind: 'transfer', node, to: RESOLVER_ADDRESS })).toMatchObject({
      address: REGISTRY_ADDRESS,
      functionName: 'transfer',
      args: [node, RESOLVER_ADDRESS],
    });
    expect(buildWrite({ kind: 'setRecord', node, coinType: 60n, value: '0x01' })).toMatchObject({
      address: RESOLVER_ADDRESS,
      functionName: 'setRecord',
      args: [node, 60n, '0x01'],
    });
    expect(buildWrite({ kind: 'setReverse', node })).toMatchObject({
      address: RESOLVER_ADDRESS,
      functionName: 'setReverse',
      args: [node],
    });
  });
});
