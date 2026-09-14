'use client';

import { notFound } from 'next/navigation';
import { useEffect, useState } from 'react';
import { USERNAME_PATTERN } from '@/components/ClaimInput';
import { MessageScreen } from '@/components/MessageScreen';
import { PayPanel } from '@/components/PayPanel';
import { AddressText } from '@/components/ui/AddressText';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ChainDot } from '@/components/ui/ChainDot';
import { Skeleton, SkeletonStatus } from '@/components/ui/Skeleton';
import { api, ApiError, type ResolveResponse } from '@/lib/api';
import type { PaytagChain } from '@/lib/chains';
import { CHAIN_META, CHAIN_ORDER } from '@/lib/pay/meta';
import { useCopy } from '@/lib/useCopy';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; resolution: ResolveResponse }
  | { kind: 'not_found' }
  | { kind: 'error' };

interface Props {
  params: { username: string };
}

export default function ProfilePage({ params }: Props) {
  const username = decodeURIComponent(params.username).toLowerCase();
  const validName = USERNAME_PATTERN.test(username);
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!validName) return;
    const controller = new AbortController();
    setState({ kind: 'loading' });
    api
      .resolve(username, controller.signal)
      .then((resolution) => {
        if (!controller.signal.aborted) setState({ kind: 'ready', resolution });
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        const missing = err instanceof ApiError && (err.code === 'USER_NOT_FOUND' || err.status === 404);
        setState({ kind: missing ? 'not_found' : 'error' });
      });
    return () => controller.abort();
  }, [username, validName, attempt]);

  // Not a possible paytag (e.g. /some-page): the route 404, not "claim it".
  if (!validName) notFound();

  if (state.kind === 'loading') return <ProfileSkeleton username={username} />;

  if (state.kind === 'not_found') {
    return (
      <MessageScreen
        kicker="Not found"
        title={`@${username} isn’t a paytag yet.`}
        copy="Nobody has claimed this name. If it’s meant to be yours, take it before someone else does."
        primary={{ label: `Claim @${username}`, href: `/claim/${username}` }}
      />
    );
  }

  if (state.kind === 'error') {
    return (
      <MessageScreen
        kicker="Something broke"
        title="We couldn’t load this page."
        copy="The resolver didn’t answer. Your wallets and names are unaffected — this is on our side. Try again in a moment."
        primary={{ label: 'Try again', onClick: () => setAttempt((n) => n + 1) }}
      />
    );
  }

  const { resolution } = state;
  const name = resolution.username;
  const verified = resolution.verified ?? {};
  const chains = CHAIN_ORDER.filter((c) => resolution.addresses[c]);
  const verifiedCount = chains.filter((c) => verified[c]).length;

  return (
    <section className="mx-auto grid w-full max-w-content gap-7 px-6 pb-24 pt-12">
      <div className="flex animate-enter flex-wrap items-center gap-[18px]">
        <span
          aria-hidden
          className="inline-flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-accent font-display text-[34px] font-bold text-on-accent"
        >
          {name.charAt(0)}
        </span>
        <div className="min-w-0">
          <h1 className="break-all font-display text-[clamp(36px,5vw,60px)] font-semibold leading-none tracking-display-lg">
            @{name}
          </h1>
          {resolution.displayName && (
            <div className="mt-2 text-[17px] font-semibold text-ink">{resolution.displayName}</div>
          )}
          {resolution.bio && (
            <p className="mt-1.5 max-w-[520px] text-[15px] leading-[1.5] text-ink2">{resolution.bio}</p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2.5">
            <div className="flex gap-1.5">
              {CHAIN_ORDER.map((c) => (
                <ChainDot
                  key={c}
                  chain={c}
                  size={12}
                  muted={!resolution.addresses[c]}
                  title={`${CHAIN_META[c].label}${resolution.addresses[c] ? '' : ' · not set'}`}
                />
              ))}
            </div>
            <span className="text-sm text-ink2">
              {chains.length} active network{chains.length === 1 ? '' : 's'}
            </span>
            {verifiedCount > 0 && (
              <Badge>
                {verifiedCount} verified wallet{verifiedCount === 1 ? '' : 's'}
              </Badge>
            )}
          </div>
        </div>
      </div>

      <div className="flex animate-enter flex-wrap items-start gap-4 [animation-delay:80ms]">
        <div className="min-w-0 flex-[3_1_380px]">
          <PayPanel
            username={name}
            chains={chains}
            addresses={resolution.addresses}
            verified={verified}
            hideProfileLink
          />
        </div>
        <aside className="grid min-w-0 flex-[2_1_280px] gap-3.5">
          <ShareCard username={name} />
          {chains.length > 0 && (
            <Card padding="compact" className="grid gap-1">
              <h2 className="mb-2 text-xs font-bold uppercase tracking-label text-ink3">Addresses</h2>
              {chains.map((chain) => (
                <AddressRow
                  key={chain}
                  chain={chain}
                  address={resolution.addresses[chain] ?? ''}
                  verified={!!verified[chain]}
                />
              ))}
            </Card>
          )}
        </aside>
      </div>
    </section>
  );
}

function ShareCard({ username }: { username: string }) {
  const { copied, copy } = useCopy();
  const [origin, setOrigin] = useState('https://paytag.dev');
  useEffect(() => setOrigin(window.location.origin), []);

  return (
    <Card padding="compact" className="grid gap-3">
      <h2 className="text-xs font-bold uppercase tracking-label text-ink3">Share link</h2>
      <div className="break-all rounded-inset-sm bg-surface2 px-3.5 py-3 font-mono text-sm">
        {origin.replace(/^https?:\/\//, '')}/{username}
      </div>
      <div className="flex items-center justify-between gap-2.5">
        <span className="text-[13px] text-ink3">Anyone can pay with this link.</span>
        <Button variant="solid" size={40} onClick={() => void copy(`${origin}/${username}`, 'Link copied')}>
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
    </Card>
  );
}

function AddressRow({ chain, address, verified }: { chain: PaytagChain; address: string; verified: boolean }) {
  const { copied, copy } = useCopy();
  const label = CHAIN_META[chain].label;

  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-t border-line py-2.5">
      <ChainDot chain={chain} size={10} />
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold">{label}</span>
          <Badge size="sm" tone={verified ? 'ok' : 'muted'}>
            {verified ? 'Verified' : 'Unverified'}
          </Badge>
        </div>
        <AddressText address={address} className="mt-0.5 text-xs" />
      </div>
      <Button
        variant="outline-muted"
        size={36}
        aria-label={`Copy ${label} address`}
        onClick={() => void copy(address, `${label} address copied`)}
      >
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  );
}

function ProfileSkeleton({ username }: { username: string }) {
  return (
    <section aria-busy="true" className="mx-auto grid w-full max-w-content gap-7 px-6 pb-24 pt-14">
      <div className="flex items-center gap-4">
        <Skeleton shape="circle" className="h-20 w-20 shrink-0" />
        <div className="grid gap-2.5">
          <Skeleton className="h-10 w-[220px] max-w-[55vw]" />
          <Skeleton className="h-3.5 w-[140px]" delay={200} />
        </div>
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(300px,100%),1fr))] gap-4">
        <Skeleton shape="card" className="h-[380px]" delay={100} />
        <Skeleton shape="card" className="h-[220px]" delay={300} />
      </div>
      <SkeletonStatus>Resolving @{username}…</SkeletonStatus>
    </section>
  );
}
