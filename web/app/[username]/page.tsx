'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { isAddress } from 'viem';
import { api, ApiError, ResolveResponse } from '@/lib/api';
import { CopyButton } from '@/components/CopyButton';
import { PayForm } from '@/components/PayForm';
import { Avatar } from '@/components/Avatar';
import { ChainGlyph } from '@/components/ChainGlyph';
import { GradientMesh } from '@/components/GradientMesh';

const CHAIN_LABELS: Record<string, string> = {
  ethereum: 'Ethereum',
  solana: 'Solana',
  bitcoin: 'Bitcoin',
};

interface Props {
  params: { username: string };
}

export default function UserPage({ params }: Props) {
  const username = params.username.toLowerCase();
  const [resolution, setResolution] = useState<ResolveResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .resolve(username)
      .then((data) => !cancelled && setResolution(data))
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : 'Could not load this paytag');
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [username]);

  if (loading) {
    return (
      <div className="max-w-[1240px] mx-auto px-6 md:px-10 py-20 text-ink-3">
        Loading…
      </div>
    );
  }

  if (error || !resolution) {
    return (
      <section className="relative overflow-hidden">
        <GradientMesh intensity="soft" />
        <div className="relative max-w-[1240px] mx-auto px-6 md:px-10 py-20 md:py-32">
          <div className="max-w-md card p-8 md:p-10">
            <div className="eyebrow mb-3 text-danger">Not found</div>
            <h1 className="font-display font-bold text-3xl md:text-4xl text-ink leading-tight mb-4">
              @{username} isn&apos;t a paytag yet
            </h1>
            <p className="text-ink-2 mb-7">
              {error ?? 'This name has not been claimed.'}
            </p>
            <Link href={`/claim/${username}`} className="btn-primary">
              <span>Claim @{username}</span>
              <span aria-hidden>→</span>
            </Link>
          </div>
        </div>
      </section>
    );
  }

  const evmAddress = resolution.addresses.ethereum;
  const evmIsValid = evmAddress && isAddress(evmAddress);
  const otherChains = (Object.entries(resolution.addresses) as [string, string][]).filter(
    ([chain]) => chain !== 'ethereum',
  );
  const link =
    typeof window !== 'undefined'
      ? `${window.location.origin}/${resolution.username}`
      : `/${resolution.username}`;
  const displayLink = link.replace(/^https?:\/\//, '');
  const activeChains = Object.values(resolution.addresses).filter(Boolean).length;

  return (
    <>
      {/* Profile hero */}
      <section className="relative overflow-hidden border-b border-hairline">
        <GradientMesh intensity="soft" />
        <div className="relative max-w-[1240px] mx-auto px-6 md:px-10 pt-14 pb-12 animate-rise rise-1">
          <div className="flex flex-col md:flex-row md:items-end gap-6 md:gap-8">
            <Avatar username={resolution.username} size={104} />
            <div>
              <div className="eyebrow mb-2">Pay</div>
              <h1 className="font-display font-bold text-4xl md:text-6xl text-ink leading-none tracking-tightish">
                @{resolution.username}
              </h1>
              <div className="mt-4 flex items-center gap-3 text-sm">
                <div className="flex items-center gap-1.5">
                  {(['ethereum', 'solana', 'bitcoin'] as const).map((c) => {
                    const has = !!resolution.addresses[c];
                    return (
                      <span
                        key={c}
                        className={has ? '' : 'opacity-25'}
                        title={`${CHAIN_LABELS[c]}${has ? '' : ' — not set'}`}
                      >
                        <ChainGlyph chain={c} size={22} />
                      </span>
                    );
                  })}
                </div>
                <span className="text-ink-3 numeric">
                  {activeChains} active network{activeChains === 1 ? '' : 's'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="max-w-[1240px] mx-auto px-6 md:px-10 py-12 md:py-16 grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Pay column */}
        <section className="lg:col-span-7 animate-rise rise-2">
          {evmIsValid ? (
            <div className="card p-7 md:p-9">
              <div className="eyebrow-muted mb-4">Send instantly</div>
              <PayForm
                username={resolution.username}
                recipient={evmAddress as `0x${string}`}
              />
            </div>
          ) : (
            <div className="card p-7 md:p-9">
              <div className="eyebrow-muted mb-3">No Ethereum address</div>
              <p className="text-ink-2">
                @{resolution.username} hasn&apos;t added an Ethereum address yet. Use one
                of the addresses on the right with your own wallet.
              </p>
            </div>
          )}
        </section>

        {/* Side column: share + other chains */}
        <aside className="lg:col-span-5 space-y-5 animate-rise rise-3">
          <div className="card p-6">
            <div className="eyebrow-muted mb-3">Share link</div>
            <div className="bg-paper border border-hairline rounded-xl p-4 font-mono text-sm text-ink break-all numeric">
              {displayLink}
            </div>
            <div className="mt-3 flex items-center justify-between">
              <span className="text-xs text-ink-3">
                Anyone can pay with this link.
              </span>
              <CopyButton value={link} label="Copy" variant="pill" />
            </div>
          </div>

          {otherChains.length > 0 && (
            <div className="card p-6">
              <div className="eyebrow-muted mb-4">Other chains</div>
              <ul className="space-y-4">
                {otherChains.map(([chain, address]) => (
                  <li
                    key={chain}
                    className="flex items-start gap-3 pb-4 last:pb-0 border-b last:border-0 border-hairline"
                  >
                    <ChainGlyph chain={chain} size={32} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-semibold text-ink">
                          {CHAIN_LABELS[chain] ?? chain}
                        </span>
                        <CopyButton value={address} />
                      </div>
                      <div className="font-mono text-xs text-ink-3 break-all numeric">
                        {address}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>
    </>
  );
}
