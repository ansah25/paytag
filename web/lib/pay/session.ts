'use client';

import { useSyncExternalStore } from 'react';

// Which non-EVM wallets are connected in this tab. EVM state already lives in
// wagmi. Kept free of chain SDK imports so the PayPanel shell can read it
// without pulling @solana/web3.js or sats-connect into the page bundle.

type SessionChain = 'solana' | 'bitcoin';
type SessionWallets = Partial<Record<SessionChain, string>>;

let wallets: SessionWallets = {};
const listeners = new Set<() => void>();
const EMPTY: SessionWallets = {};

export function setSessionWallet(chain: SessionChain, address: string | null): void {
  if ((wallets[chain] ?? null) === address) return;
  const next = { ...wallets };
  if (address) next[chain] = address;
  else delete next[chain];
  wallets = next;
  listeners.forEach((listener) => listener());
}

export const getSessionWallet = (chain: SessionChain): string | null => wallets[chain] ?? null;

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export function useSessionWallets(): SessionWallets {
  return useSyncExternalStore(
    subscribe,
    () => wallets,
    () => EMPTY,
  );
}

/** Record Phantom as connected if it already trusts this site (no SDK needed). */
export function syncPhantomSession(): void {
  if (typeof window === 'undefined') return;
  const phantom = window.phantom?.solana ?? window.solana;
  if (phantom?.isPhantom && phantom.isConnected && phantom.publicKey) {
    setSessionWallet('solana', phantom.publicKey.toString());
  }
}
