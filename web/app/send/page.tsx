'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { isAddress } from 'viem';
import { api, ApiError, ResolveResponse } from '@/lib/api';
import { PayForm } from '@/components/PayForm';
import { Avatar } from '@/components/Avatar';
import { ChainGlyph } from '@/components/ChainGlyph';
import { GradientMesh } from '@/components/GradientMesh';

type Status = 'idle' | 'looking' | 'found' | 'missing';

const shortAddr = (addr: string) => `${addr.slice(0, 6)}…${addr.slice(-4)}`;

export default function SendPage() {
  const [recipient, setRecipient] = useState('');
  const [resolution, setResolution] = useState<ResolveResponse | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
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

  const evmAddress = resolution?.addresses.ethereum;
  const canPay = !!(evmAddress && isAddress(evmAddress));
  const trimmed = recipient.trim().replace(/^@/, '').toLowerCase();

  return (
    <>
      <section className="relative overflow-hidden border-b border-hairline">
        <GradientMesh intensity="soft" />
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
            <div className="card p-5 md:p-6 flex items-center gap-4 bg-gradient-to-br from-white to-paper">
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
                {(['ethereum', 'solana', 'bitcoin'] as const).map((c) => {
                  const has = !!resolution.addresses[c];
                  return (
                    <span key={c} className={has ? '' : 'opacity-25'} title={c}>
                      <ChainGlyph chain={c} size={22} />
                    </span>
                  );
                })}
              </div>
            </div>
          </section>
        )}

        {/* Pay form */}
        {status === 'found' && resolution && canPay && (
          <section className="card p-7 md:p-9 animate-rise">
            <PayForm username={resolution.username} recipient={evmAddress as `0x${string}`} />
          </section>
        )}

        {status === 'found' && resolution && !canPay && (
          <div className="card p-6 text-sm text-ink-2">
            @{resolution.username} hasn&apos;t added an Ethereum address yet.{' '}
            <Link
              href={`/${resolution.username}`}
              className="text-primary font-semibold hover:underline underline-offset-4"
            >
              View other chains →
            </Link>
          </div>
        )}
      </div>
    </>
  );
}
