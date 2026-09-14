'use client';

// Temporary: PayPanel wired in for step 4. The page itself is rewritten in step 8.

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { api, ApiError, ResolveResponse } from '@/lib/api';
import { CopyButton } from '@/components/CopyButton';
import { Avatar } from '@/components/Avatar';
import { ChainGlyph } from '@/components/ChainGlyph';
import { PayPanel } from '@/components/PayPanel';
import { CHAIN_LABELS, PaytagChain } from '@/lib/chains';

const CHAIN_ORDER: PaytagChain[] = ['ethereum', 'solana', 'bitcoin'];

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

  const availableChains = useMemo<PaytagChain[]>(() => {
    if (!resolution) return [];
    return CHAIN_ORDER.filter((c) => Boolean(resolution.addresses[c]));
  }, [resolution]);

  if (loading) {
    return <div className="max-w-[1240px] mx-auto px-6 md:px-10 py-20 text-ink2">Loading…</div>;
  }

  if (error || !resolution) {
    return (
      <section className="max-w-[1240px] mx-auto px-6 md:px-10 py-20 md:py-32">
        <div className="max-w-md border border-line p-8 md:p-10">
          <div className="mb-3 text-danger">Not found</div>
          <h1 className="font-display font-bold text-3xl md:text-4xl text-ink leading-tight mb-4">
            @{username} isn&apos;t a paytag yet
          </h1>
          <p className="text-ink2 mb-7">{error ?? 'This name has not been claimed.'}</p>
          <Link href={`/claim/${username}`} className="text-accent font-semibold">
            Claim @{username} →
          </Link>
        </div>
      </section>
    );
  }

  const addressEntries = Object.entries(resolution.addresses) as [PaytagChain, string][];
  const link =
    typeof window !== 'undefined'
      ? `${window.location.origin}/${resolution.username}`
      : `/${resolution.username}`;
  const displayLink = link.replace(/^https?:\/\//, '');

  return (
    <>
      <section className="max-w-[1240px] mx-auto px-6 md:px-10 pt-14 pb-12">
        <div className="flex flex-col md:flex-row md:items-end gap-6 md:gap-8">
          <Avatar username={resolution.username} size={104} />
          <div>
            <h1 className="font-display font-bold text-4xl md:text-6xl text-ink leading-none">
              @{resolution.username}
            </h1>
            <div className="mt-4 flex items-center gap-3 text-sm">
              <div className="flex items-center gap-1.5">
                {CHAIN_ORDER.map((c) => (
                  <span
                    key={c}
                    className={resolution.addresses[c] ? '' : 'opacity-25'}
                    title={CHAIN_LABELS[c]}
                  >
                    <ChainGlyph chain={c} size={22} />
                  </span>
                ))}
              </div>
              <span className="text-ink2 numeric">
                {availableChains.length} active network{availableChains.length === 1 ? '' : 's'}
              </span>
            </div>
          </div>
        </div>
      </section>

      <div className="max-w-[1240px] mx-auto px-6 md:px-10 py-12 md:py-16 grid grid-cols-1 lg:grid-cols-12 gap-8">
        <section className="lg:col-span-7">
          <PayPanel
            username={resolution.username}
            chains={availableChains}
            addresses={resolution.addresses}
            hideProfileLink
          />
        </section>

        <aside className="lg:col-span-5 space-y-5">
          <div className="border border-line p-6">
            <div className="mb-3">Share link</div>
            <div className="border border-line p-4 font-mono text-sm text-ink break-all numeric">
              {displayLink}
            </div>
            <div className="mt-3 flex items-center justify-between">
              <span className="text-xs text-ink2">Anyone can pay with this link.</span>
              <CopyButton value={link} label="Copy" variant="pill" />
            </div>
          </div>

          {addressEntries.length > 0 && (
            <div className="border border-line p-6">
              <div className="mb-4">Addresses</div>
              <ul className="space-y-4">
                {addressEntries.map(([chain, address]) => (
                  <li key={chain} className="flex items-start gap-3">
                    <ChainGlyph chain={chain} size={32} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-semibold text-ink">
                          {CHAIN_LABELS[chain] ?? chain}
                        </span>
                        <CopyButton value={address} />
                      </div>
                      <div className="font-mono text-xs text-ink2 break-all numeric">{address}</div>
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
