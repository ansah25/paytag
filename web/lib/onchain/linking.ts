import type { OnchainLinkStatus } from '@paytagdev/sdk';
import type { ResolveResponse } from '@/lib/api';

// Linking between a Paytag account (off-chain, the API) and the on-chain name of the same
// spelling (the Base registry). The API decides the status: linked when the on-chain owner is
// the account's *verified* Ethereum address. The two keep separate records either way.

/**
 * Whether the Paytag account in `resolution` would count `wallet` as its own for linking:
 * `wallet` is its verified Ethereum address. Uses public fields only, the same rule the API
 * applies.
 */
export function accountLinksTo(resolution: ResolveResponse, wallet: string): boolean {
  const eth = resolution.addresses.ethereum;
  return !!resolution.verified?.ethereum && !!eth && eth.toLowerCase() === wallet.toLowerCase();
}

/** The status, or `unavailable` when an older API didn't send one. */
export function linkStatusOf(resolution: ResolveResponse): OnchainLinkStatus {
  return resolution.onchain?.status ?? 'unavailable';
}

export interface DashboardLinkCopy {
  tone: 'ok' | 'muted' | 'warn';
  title: string;
  body: string;
  action: { label: string; href: string } | null;
}

/** The dashboard's "Your on-chain name" card, for the signed-in owner of `username`. */
export function dashboardLinkCopy(
  username: string,
  status: OnchainLinkStatus,
  ethVerified: boolean,
): DashboardLinkCopy {
  const view = { label: 'View on-chain', href: `/on-chain/${username}` };
  switch (status) {
    case 'linked':
      return {
        tone: 'ok',
        title: `@${username} is linked`,
        body: 'Your verified Ethereum address owns this name in the on-chain registry on Base.',
        action: view,
      };
    case 'none':
      return {
        tone: 'muted',
        title: `Register @${username} on Base`,
        body: 'Hold the same name in the on-chain registry. It links once your verified Ethereum address owns it.',
        action: { label: 'Register on-chain', href: `/on-chain?name=${username}` },
      };
    case 'not_linked':
      return {
        tone: 'warn',
        title: `@${username} on-chain isn’t linked`,
        body: ethVerified
          ? 'Someone holds this name on-chain, but not your verified Ethereum address. Payments to your paytag link are unaffected.'
          : 'Someone holds this name on-chain. If it’s your wallet, verify your Ethereum address below to link it.',
        action: view,
      };
    case 'syncing':
      return {
        tone: 'muted',
        title: 'On-chain name',
        body: 'Couldn’t check the on-chain name just now. Check back in a moment.', // no longer sent by the API
        action: null,
      };
    case 'unavailable':
      return {
        tone: 'muted',
        title: 'On-chain name',
        body: 'Couldn’t check the on-chain registry right now.',
        action: null,
      };
  }
}
