import { describe, expect, it } from 'vitest';
import type { ResolveResponse } from '@/lib/api';
import { accountLinksTo, dashboardLinkCopy, linkStatusOf } from './linking';

const WALLET = '0x6aD631F215393f9635231de985081B1ccDDC7C11';
const resolution = (over: Partial<ResolveResponse> = {}): ResolveResponse => ({
  username: 'derrick',
  addresses: { ethereum: WALLET.toLowerCase() },
  verified: { ethereum: true },
  ...over,
});

describe('accountLinksTo', () => {
  it('matches the verified Ethereum address, any casing', () => {
    expect(accountLinksTo(resolution(), WALLET)).toBe(true);
  });

  it('does not count an unverified or different address', () => {
    expect(accountLinksTo(resolution({ verified: {} }), WALLET)).toBe(false);
    expect(accountLinksTo(resolution(), '0x0000000000000000000000000000000000000001')).toBe(false);
    expect(accountLinksTo(resolution({ addresses: {} }), WALLET)).toBe(false);
  });
});

describe('linkStatusOf', () => {
  it('reads the API status, and treats an older API as unavailable', () => {
    expect(linkStatusOf(resolution({ onchain: { status: 'linked' } }))).toBe('linked');
    expect(linkStatusOf(resolution())).toBe('unavailable');
  });
});

describe('dashboardLinkCopy', () => {
  it('links to the on-chain page when linked', () => {
    const copy = dashboardLinkCopy('derrick', 'linked', true);
    expect(copy.tone).toBe('ok');
    expect(copy.action).toEqual({ label: 'View on-chain', href: '/on-chain/derrick' });
  });

  it('offers registration, prefilled, when the name is free on-chain', () => {
    expect(dashboardLinkCopy('derrick', 'none', true).action).toEqual({
      label: 'Register on-chain',
      href: '/on-chain?name=derrick',
    });
  });

  it('points at verification when the Ethereum address is unverified', () => {
    expect(dashboardLinkCopy('derrick', 'not_linked', false).body).toMatch(/verify your Ethereum address/);
    expect(dashboardLinkCopy('derrick', 'not_linked', true).body).not.toMatch(/verify/);
  });

  it('has no action while the status is unknown', () => {
    expect(dashboardLinkCopy('derrick', 'syncing', true).action).toBeNull();
    expect(dashboardLinkCopy('derrick', 'unavailable', true).action).toBeNull();
  });
});
