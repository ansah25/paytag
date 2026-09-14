'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import type { ResolveResponse } from '@/lib/api';
import { cx } from '@/lib/cx';
import { shortAddress } from '@/lib/format';
import { CHAIN_META, CHAIN_ORDER } from '@/lib/pay/meta';
import { useCopy } from '@/lib/useCopy';

const joinWithAnd = (items: string[]) =>
  items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

interface Props {
  username: string;
  createdAt: string | null;
  resolution: ResolveResponse | null | 'loading';
}

/** Success view at the end of the claim wizard (formerly /welcome). */
export function ClaimDone({ username, createdAt, resolution }: Props) {
  const { copied, copy } = useCopy();
  const [host, setHost] = useState('paytag.dev');
  useEffect(() => setHost(window.location.host), []);

  const loading = resolution === 'loading';
  const addresses = resolution && resolution !== 'loading' ? resolution.addresses : {};
  const activeCount = CHAIN_ORDER.filter((c) => addresses[c]).length;
  const missing = CHAIN_ORDER.filter((c) => !addresses[c]).map((c) => CHAIN_META[c].label);
  const memberSince = createdAt
    ? new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric' }).format(new Date(createdAt))
    : null;

  const copyText = loading
    ? 'Anyone with a wallet can now pay you with one link.'
    : missing.length === 0
      ? 'Every chain is mapped. Share your link and start getting paid.'
      : `${addresses.ethereum ? 'Your Ethereum wallet is already mapped. ' : ''}Add ${joinWithAnd(missing)} on your dashboard so people can pay you on any chain.`;

  return (
    <section className="mx-auto grid w-full max-w-content animate-enter grid-cols-[repeat(auto-fit,minmax(min(320px,100%),1fr))] items-center gap-12 px-6 pb-24 pt-16">
      <div className="min-w-0">
        <div className="inline-flex items-center gap-2 rounded-pill bg-ok-bg px-3.5 py-1.5 text-[13px] font-semibold text-ok">
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-ok" />
          Registered
        </div>
        <h1 className="mt-[22px] break-words font-display text-[clamp(44px,6vw,84px)] font-semibold leading-[0.96] tracking-display-lg [text-wrap:balance]">
          @{username} is yours.
        </h1>
        <p className="mt-[22px] max-w-[480px] text-lg leading-[1.55] text-ink2 [text-wrap:pretty]">{copyText}</p>
        <div className="mt-8 flex flex-wrap gap-2">
          <Button size={48} href="/app">
            Add more wallets
          </Button>
          <Button size={48} variant="outline" href={`/${username}`}>
            View public page
          </Button>
        </div>
      </div>

      <Card elevated padding="none" className="grid gap-6 p-7">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span
              aria-hidden
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent font-display text-xl font-bold text-on-accent"
            >
              {username.charAt(0)}
            </span>
            <div className="min-w-0">
              <div className="truncate font-display text-[22px] font-semibold tracking-display">@{username}</div>
              {memberSince && <div className="font-mono text-xs text-ink2">member since {memberSince}</div>}
            </div>
          </div>
          {!loading && (
            <span className="shrink-0 whitespace-nowrap rounded-pill border border-line2 px-2.5 py-1 text-[11px] font-bold uppercase tracking-kicker text-accent">
              {activeCount} of 3 chains
            </span>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 rounded-inset bg-surface2 px-[18px] py-4">
          <span className="min-w-0 break-all font-mono text-[15px]">
            {host}/{username}
          </span>
          <Button
            variant="solid"
            size={40}
            onClick={() => void copy(`${window.location.origin}/${username}`, 'Link copied')}
          >
            {copied ? 'Copied' : 'Copy link'}
          </Button>
        </div>

        <div className="grid grid-cols-3 gap-2.5">
          {CHAIN_ORDER.map((chain, i) => {
            if (loading) return <Skeleton key={chain} shape="block" className="h-[62px]" delay={i * 100} />;
            const address = addresses[chain];
            return (
              <div
                key={chain}
                className={cx(
                  'min-w-0 rounded-inset-sm p-3',
                  address ? 'bg-surface2' : 'border border-dashed border-line2',
                )}
              >
                <div
                  className={cx('text-[11px] font-bold tracking-label', address ? 'text-ink2' : 'text-ink3')}
                >
                  {CHAIN_META[chain].symbol}
                </div>
                {address ? (
                  <div className="mt-1.5 truncate font-mono text-xs" title={address}>
                    {shortAddress(address, 4, 4)}
                  </div>
                ) : (
                  <div className="mt-1.5 text-xs text-ink3">Not set</div>
                )}
              </div>
            );
          })}
        </div>
      </Card>
    </section>
  );
}
