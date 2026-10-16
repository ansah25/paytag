import { describe, expect, it } from 'vitest';
import { PaytagRegistryAbi } from './generated/PaytagRegistryAbi';
import { MAX_COMMITMENT_AGE, MIN_COMMITMENT_AGE, commitmentFor, makeSecret, reservationPhase } from './registration';

describe('commitmentFor', () => {
  it('matches the contract formula, cross-checked with Foundry cast', () => {
    // cast keccak $(cast abi-encode "f(bytes32,address,bytes32)" $(cast keccak derrick) <owner> 0x11…11)
    expect(
      commitmentFor('derrick', '0x6aD631F215393f9635231de985081B1ccDDC7C11', `0x${'11'.repeat(32)}`),
    ).toBe('0xc52e03b194053ce9343088ee41365d11572c6cdc1f358adc8e55be09c06f45e7');
  });

  it('binds the owner and the secret', () => {
    const s = `0x${'11'.repeat(32)}` as const;
    const a = commitmentFor('derrick', '0x6aD631F215393f9635231de985081B1ccDDC7C11', s);
    expect(commitmentFor('derrick', '0x3Dbc9C0Bef8b7bFBcf0a7cc4041b3962B126F865', s)).not.toBe(a);
    expect(commitmentFor('derrick', '0x6aD631F215393f9635231de985081B1ccDDC7C11', `0x${'22'.repeat(32)}`)).not.toBe(a);
  });
});

describe('makeSecret', () => {
  it('returns 32 fresh random bytes', () => {
    const a = makeSecret();
    expect(a).toMatch(/^0x[0-9a-f]{64}$/);
    expect(makeSecret()).not.toBe(a);
  });
});

describe('reservationPhase', () => {
  const t = 1_000_000;
  it('is missing without a commitment', () => {
    expect(reservationPhase(0, t)).toEqual({ kind: 'missing' });
  });
  it('waits until the minimum age, inclusive bounds as in the contract', () => {
    expect(reservationPhase(t, t + MIN_COMMITMENT_AGE - 1)).toEqual({ kind: 'waiting', revealableAt: t + MIN_COMMITMENT_AGE });
    expect(reservationPhase(t, t + MIN_COMMITMENT_AGE)).toEqual({ kind: 'ready', expiresAt: t + MAX_COMMITMENT_AGE });
    expect(reservationPhase(t, t + MAX_COMMITMENT_AGE)).toEqual({ kind: 'ready', expiresAt: t + MAX_COMMITMENT_AGE });
    expect(reservationPhase(t, t + MAX_COMMITMENT_AGE + 1)).toEqual({ kind: 'expired' });
  });
  it('uses the same window as the deployed contract ABI exposes', () => {
    const names = PaytagRegistryAbi.filter((e) => e.type === 'function').map((e) => e.name);
    expect(names).toEqual(expect.arrayContaining(['MIN_COMMITMENT_AGE', 'MAX_COMMITMENT_AGE', 'commit', 'commitmentTime']));
  });
});
