'use client';

import { useSyncExternalStore } from 'react';
import { useAccount } from 'wagmi';

const noopSubscribe = () => () => {};

/** False during server render and hydration, true afterwards. */
export function useHydrated(): boolean {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}

/**
 * useAccount, but "reconnecting" until hydration is done. The server can't know the wallet, and
 * with the root loading.tsx streaming the page in later, wagmi has often reconnected by the time
 * the page hydrates, so reading it directly renders "connected" against server HTML that wasn't
 * (a hydration mismatch). Reporting "reconnecting" on both sides lets the UI show a neutral
 * checking state instead of flashing "Connect wallet"; the real state follows one render later.
 */
export function useHydratedAccount() {
  const { address, chainId, status } = useAccount();
  const hydrated = useHydrated();
  return hydrated
    ? { address, chainId, status }
    : { address: undefined, chainId: undefined, status: 'reconnecting' as const };
}
