'use client';

import { useSyncExternalStore } from 'react';
import { useAccount } from 'wagmi';

const noopSubscribe = () => () => {};

/** False during server render and hydration, true afterwards. */
export function useHydrated(): boolean {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}

/**
 * useAccount, but disconnected until hydration is done. The server always renders the
 * disconnected UI; with the root loading.tsx streaming the page in later, wagmi has often
 * reconnected by the time the page hydrates, so reading it directly renders "connected" against
 * "disconnected" server HTML (a hydration mismatch). The real state follows one render later.
 */
export function useHydratedAccount() {
  const { address, chainId, status } = useAccount();
  const hydrated = useHydrated();
  return hydrated
    ? { address, chainId, status }
    : { address: undefined, chainId: undefined, status: 'disconnected' as const };
}
