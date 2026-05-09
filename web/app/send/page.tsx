'use client';

import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useEffect, useMemo, useRef, useState } from 'react';
import { isAddress } from 'viem';
import { api, ApiError, ResolveResponse } from '@/lib/api';
import { Avatar } from '@/components/Avatar';
import { ChainGlyph } from '@/components/ChainGlyph';
import { CardGlow } from '@/components/CardGlow';
import { CHAIN_LABELS, CHAIN_NATIVE_SYMBOL, PaytagChain } from '@/lib/chains';

// Same code-split as /[username]: each chain SDK is heavy and only one is in
// use at a time, so we load them on demand instead of bundling all three.
const PayForm = dynamic(
  () => import('@/components/PayForm').then((m) => ({ default: m.PayForm })),
  { ssr: false },
);
const PayFormSolana = dynamic(
  () => import('@/components/PayFormSolana').then((m) => ({ default: m.PayFormSolana })),
  { ssr: false },
);
const PayFormBitcoin = dynamic(
  () => import('@/components/PayFormBitcoin').then((m) => ({ default: m.PayFormBitcoin })),
  { ssr: false },
);

type Status = 'idle' | 'looking' | 'found' | 'missing';
const CHAIN_ORDER: PaytagChain[] = ['ethereum', 'solana', 'bitcoin'];

const shortAddr = (addr: string) => `${addr.slice(0, 6)}…${addr.slice(-4)}`;

export default function SendPage() {
  const [recipient, setRecipient] = useState('');
  const [resolution, setResolution] = useState<ResolveResponse | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [selectedChain, setSelectedChain] = useState<PaytagChain | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    abortRef.current?.abort();

    const trimmed = recipient.trim().toLowerCase().replace(/^@/, '');
    setErrorMsg(null);

    if (!trimmed) {
      setStatus('idle');
      setResolution(null);
      return;
    }

    setStatus('looking');
    debounceRef.current = setTimeout(async () => {
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const data = await api.resolve(trimmed, controller.signal);
        if (controller.signal.aborted) return;
        setResolution(data);
        setStatus('found');
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        setResolution(null);
        setStatus('missing');
        if (err instanceof ApiError && err.code !== 'USER_NOT_FOUND') {
          setErrorMsg(err.message);
        }
      }
    }, 280);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      abortRef.current?.abort();
    };
  }, [recipient]);

  const availableChains = useMemo<PaytagChain[]>(() => {
    if (!resolution) return [];
    return CHAIN_ORDER.filter((c) => Boolean(resolution.addresses[c]));
  }, [resolution]);

  // Auto-select the first available chain whenever the recipient changes.
  useEffect(() => {
    if (availableChains.length === 0) {
      setSelectedChain(null);
      return;
    }
    if (!selectedChain || !availableChains.includes(selectedChain)) {
      setSelectedChain(availableChains[0]);
    }
  }, [availableChains, selectedChain]);

  const evmAddress = resolution?.addresses.ethereum;
  const trimmed = recipient.trim().replace(/^@/, '').toLowerCase();
  const recipientForChain = selectedChain ? resolution?.addresses[selectedChain] : undefined;

  return (
    <>
      <section className="relative overflow-hidden">
        <div className="relative max-w-[1240px] mx-auto px-6 md:px-10 pt-14 pb-10">
          <div className="max-w-2xl animate-rise rise-1">
            <div className="eyebrow mb-3">Send</div>
            <h1 className="font-display font-bold text-4xl md:text-6xl text-ink leading-[0.98] tracking-tightish">
              Send to a name.
            </h1>
            <p className="mt-4 text-ink-2 text-lg max-w-md">
              Type any @paytag and we&apos;ll resolve it. Pick the network, hit send.
            </p>
          </div>
        </div>
      </section>

      <div className="max-w-2xl mx-auto px-6 md:px-10 py-12 md:py-16 space-y-8">
        {/* Recipient input */}
        <section className="animate-rise rise-2">
          <div className="eyebrow-muted mb-3">To</div>
          <div className="flex items-center gap-3 bg-white border-2 border-hairline focus-within:border-primary focus-within:shadow-[0_0_0_4px_rgba(84,105,212,0.15)] rounded-2xl pl-5 pr-3 py-2.5 transition-all">
            <span
              className="font-display font-bold text-3xl md:text-4xl select-none"
              style={{
                backgroundImage:
                  'linear-gradient(135deg, #5469D4 0%, #7E5CFF 50%, #FF5A6E 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              @
            </span>
            <input
              value={recipient}
              onChange={(e) => setRecipient(e.target.value.toLowerCase().replace(/^@/, ''))}
              placeholder="username"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              autoFocus
              className="flex-1 bg-transparent border-0 outline-none text-2xl md:text-3xl font-display font-semibold text-ink placeholder:text-ink-4/60 min-w-0"
            />
          </div>

          <div className="min-h-[20px] mt-3 px-1 text-sm">
            {status === 'idle' && (
              <span className="text-ink-4">
                Try @derrick, @alice_99, anyone with a paytag.
              </span>
            )}
            {status === 'looking' && (
              <span className="text-ink-3 inline-flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                Looking up @{trimmed}…
              </span>
            )}
            {status === 'missing' && (
              <span className="text-danger">
                {errorMsg ?? `@${trimmed} doesn’t exist.`}{' '}
                <Link
                  href={`/claim/${trimmed}`}
                  className="underline underline-offset-4 hover:no-underline"
                >
                  Claim it →
                </Link>
              </span>
            )}
          </div>
        </section>

        {/* Recipient preview card */}
        {status === 'found' && resolution && (
          <section className="animate-rise">
            <div className="card card-hover p-5 md:p-6 relative overflow-hidden">
              <CardGlow color="#7E5CFF" />
              <div className="relative flex items-center gap-4">
                <Avatar username={resolution.username} size={56} />
                <div className="flex-1 min-w-0">
                  <div className="font-display font-bold text-xl md:text-2xl text-ink">
                    @{resolution.username}
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-xs text-ink-3 numeric">
                    {evmAddress && (
                      <span className="font-mono">{shortAddr(evmAddress)}</span>
                    )}
                    <span>·</span>
                    <span>
                      {Object.values(resolution.addresses).filter(Boolean).length} active
                      network{Object.values(resolution.addresses).filter(Boolean).length === 1 ? '' : 's'}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {CHAIN_ORDER.map((c) => {
                    const has = !!resolution.addresses[c];
                    return (
                      <span key={c} className={has ? '' : 'opacity-25'} title={c}>
                        <ChainGlyph chain={c} size={22} />
                      </span>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Chain selector — only when the recipient supports more than one */}
        {status === 'found' && resolution && availableChains.length > 1 && selectedChain && (
          <section className="animate-rise">
            <div className="eyebrow-muted mb-3">Pay with</div>
            <div className="grid grid-cols-3 gap-2">
              {availableChains.map((c) => {
                const active = selectedChain === c;
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setSelectedChain(c)}
                    className={`flex items-center justify-center gap-2 px-3 py-3 rounded-2xl border transition-colors ${
                      active
                        ? 'border-primary bg-primary/5 text-primary'
                        : 'border-hairline bg-white text-ink-2 hover:border-primary/40'
                    }`}
                  >
                    <ChainGlyph chain={c} size={20} />
                    <span className="text-sm font-semibold">
                      {CHAIN_LABELS[c]}{' '}
                      <span className="font-mono text-xs text-ink-4">
                        {CHAIN_NATIVE_SYMBOL[c]}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* Pay form — chain-aware */}
        {status === 'found' &&
          resolution &&
          selectedChain === 'ethereum' &&
          evmAddress &&
          isAddress(evmAddress) && (
            <section className="card card-hover p-7 md:p-9 animate-rise relative overflow-hidden">
              <CardGlow color="#5469D4" size="lg" />
              <div className="relative">
                <PayForm
                  username={resolution.username}
                  recipient={evmAddress as `0x${string}`}
                />
              </div>
            </section>
          )}

        {status === 'found' &&
          resolution &&
          selectedChain === 'solana' &&
          recipientForChain && (
            <section className="card card-hover p-7 md:p-9 animate-rise relative overflow-hidden">
              <CardGlow color="#7E5CFF" size="lg" />
              <div className="relative">
                <PayFormSolana
                  username={resolution.username}
                  recipient={recipientForChain}
                />
              </div>
            </section>
          )}

        {status === 'found' &&
          resolution &&
          selectedChain === 'bitcoin' &&
          recipientForChain && (
            <section className="card card-hover p-7 md:p-9 animate-rise relative overflow-hidden">
              <CardGlow color="#FFB547" size="lg" />
              <div className="relative">
                <PayFormBitcoin
                  username={resolution.username}
                  recipient={recipientForChain}
                />
              </div>
            </section>
          )}

        {status === 'found' && resolution && availableChains.length === 0 && (
          <div className="card p-6 text-sm text-ink-2">
            @{resolution.username} hasn&apos;t added any addresses yet.{' '}
            <Link
              href={`/${resolution.username}`}
              className="text-primary font-semibold hover:underline underline-offset-4"
            >
              View profile →
            </Link>
          </div>
        )}
      </div>
    </>
  );
}
