'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { isAddress } from 'viem';
import { api, ApiError, ResolveResponse } from '@/lib/api';
import { PayForm } from '@/components/PayForm';
import { CopyButton } from '@/components/CopyButton';

const CHAIN_LABELS: Record<string, string> = {
  ethereum: 'Ethereum',
  solana: 'Solana',
  bitcoin: 'Bitcoin',
};

interface Props {
  params: { username: string };
}

export default function PayPage({ params }: Props) {
  const username = params.username.toLowerCase();
  const [resolution, setResolution] = useState<ResolveResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .resolve(username)
      .then((data) => {
        if (!cancelled) setResolution(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Resolution failed');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [username]);

  if (loading) {
    return <div className="text-muted">Loading…</div>;
  }

  if (error || !resolution) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Pay @{username}</h1>
        <div className="p-4 rounded-lg bg-red-950/40 border border-red-800/50 text-red-200 text-sm">
          {error ?? 'Username not found'}
        </div>
        <Link href="/" className="text-accent text-sm hover:underline">
          ← Back
        </Link>
      </div>
    );
  }

  const evmAddress = resolution.addresses.ethereum;
  const evmIsValid = evmAddress && isAddress(evmAddress);
  const otherChains = (Object.entries(resolution.addresses) as [string, string][]).filter(
    ([chain]) => chain !== 'ethereum',
  );

  return (
    <div className="space-y-8 max-w-xl">
      <header className="space-y-1">
        <Link href="/" className="text-sm text-muted hover:text-white">
          ← Back
        </Link>
        <h1 className="text-2xl font-semibold">Pay @{resolution.username}</h1>
      </header>

      {evmIsValid ? (
        <section className="bg-panel border border-border rounded-xl p-6 space-y-4">
          <div className="space-y-1">
            <div className="text-xs text-muted">Recipient address</div>
            <div className="font-mono text-sm break-all">{evmAddress}</div>
          </div>
          <PayForm username={resolution.username} recipient={evmAddress as `0x${string}`} />
        </section>
      ) : (
        <div className="p-4 rounded-lg bg-panel border border-border text-muted text-sm">
          @{resolution.username} hasn&apos;t added an Ethereum address yet.
        </div>
      )}

      {otherChains.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm text-muted">Other chains</h2>
          <ul className="space-y-2">
            {otherChains.map(([chain, address]) => (
              <li
                key={chain}
                className="p-4 rounded-lg bg-panel border border-border space-y-2"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-muted">
                    {CHAIN_LABELS[chain] ?? chain}
                  </span>
                  <CopyButton value={address} />
                </div>
                <div className="font-mono text-xs break-all">{address}</div>
                <div className="text-xs text-muted">
                  Send from your {CHAIN_LABELS[chain] ?? chain} wallet to this address.
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
