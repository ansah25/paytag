'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useAccount, useConnect, useSignMessage } from 'wagmi';
import { api, ApiError, buildSignMessage } from '@/lib/api';
import { saveAuth, updateAuth } from '@/lib/auth';
import { Avatar } from '@/components/Avatar';
import { GradientMesh } from '@/components/GradientMesh';

type Step =
  | 'checking'
  | 'unavailable'
  | 'connect'
  | 'sign'
  | 'register'
  | 'done'
  | 'error';

interface Props {
  params: { username: string };
}

export default function ClaimPage({ params }: Props) {
  const router = useRouter();
  const username = params.username.toLowerCase();

  const { address, isConnected } = useAccount();
  const { connectors, connect, isPending: connecting, error: connectErr } = useConnect();
  const injected = connectors.find((c) => c.type === 'injected') ?? connectors[0];
  const { signMessageAsync } = useSignMessage();

  const [step, setStep] = useState<Step>('checking');
  const [message, setMessage] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const registeringRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    api
      .available(username)
      .then((res) => {
        if (cancelled) return;
        if (res.available) {
          setStep(isConnected && address ? 'sign' : 'connect');
        } else {
          setStep('unavailable');
          setSuggestions(res.suggestions);
          setMessage(
            res.reason === 'INVALID_FORMAT'
              ? 'That username is not valid.'
              : res.reason === 'RESERVED'
                ? 'That username is reserved.'
                : 'That username is already taken.',
          );
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setStep('error');
        setMessage(err instanceof ApiError ? err.message : 'Could not check availability');
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username]);

  useEffect(() => {
    if (step === 'connect' && isConnected && address) {
      setStep('sign');
    }
  }, [step, isConnected, address]);

  const handleSign = async () => {
    if (!address) return;
    setMessage(null);
    try {
      const { nonce } = await api.getNonce(address);
      const signature = await signMessageAsync({ message: buildSignMessage(nonce) });
      const { token, wallet } = await api.verify(address, signature);
      saveAuth({ token, wallet });
      setStep('register');
    } catch (err) {
      setStep('error');
      setMessage(err instanceof ApiError ? err.message : (err as Error).message);
    }
  };

  useEffect(() => {
    if (step !== 'register' || registeringRef.current) return;
    registeringRef.current = true;
    (async () => {
      try {
        const result = await api.register(username);
        updateAuth({ username: result.username });
        setStep('done');
        router.replace(`/welcome?u=${encodeURIComponent(result.username)}`);
      } catch (err) {
        setStep('error');
        setMessage(err instanceof ApiError ? err.message : (err as Error).message);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  return (
    <>
      <section className="relative overflow-hidden border-b border-hairline">
        <GradientMesh intensity="soft" />
        <div className="relative max-w-[1240px] mx-auto px-6 md:px-10 pt-14 pb-10 animate-rise rise-1">
          <Link
            href="/"
            className="inline-flex items-center gap-1 text-sm text-ink-2 hover:text-primary mb-6 font-medium"
          >
            <span aria-hidden>←</span>
            <span>Back</span>
          </Link>
          <div className="flex items-end gap-5">
            <Avatar username={username} size={88} />
            <div>
              <div className="eyebrow mb-2">Claiming</div>
              <h1 className="font-display font-bold text-4xl md:text-6xl text-ink leading-none tracking-tightish">
                @{username}
              </h1>
            </div>
          </div>
        </div>
      </section>

      <div className="max-w-[1240px] mx-auto px-6 md:px-10 py-12 md:py-16 grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Stepper */}
        <aside className="lg:col-span-4 animate-rise rise-1">
          <Stepper current={step} />
        </aside>

        {/* Step content */}
        <section className="lg:col-span-8 animate-rise rise-2">
          <div className="card p-7 md:p-10 min-h-[280px]">
            {step === 'checking' && (
              <div className="flex items-center gap-3 text-ink-3">
                <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                <span>Checking availability…</span>
              </div>
            )}

            {step === 'unavailable' && (
              <div className="space-y-6">
                <div>
                  <div className="eyebrow mb-2 text-danger">Unavailable</div>
                  <p className="text-lg text-ink">{message}</p>
                </div>
                {suggestions.length > 0 && (
                  <div>
                    <div className="eyebrow-muted mb-3">Try one of these</div>
                    <div className="flex flex-wrap gap-2">
                      {suggestions.map((s) => (
                        <Link
                          key={s}
                          href={`/claim/${s}`}
                          className="font-mono text-sm text-ink-2 bg-white border border-hairline hover:border-primary hover:text-primary rounded-full px-3 py-1.5 transition-colors numeric"
                        >
                          @{s}
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
                <Link href="/" className="btn-bare">
                  <span>Choose a different name</span>
                  <span aria-hidden>→</span>
                </Link>
              </div>
            )}

            {step === 'connect' && (
              <div className="space-y-5">
                <div className="eyebrow">Step 02 — Connect</div>
                <h2 className="font-display font-bold text-3xl text-ink leading-tight">
                  Connect a wallet
                </h2>
                <p className="text-ink-2">
                  We&apos;ll use this wallet as your default Ethereum address. Paytag never
                  stores private keys.
                </p>
                <button
                  onClick={() => injected && connect({ connector: injected })}
                  disabled={!injected || connecting}
                  className="btn-primary"
                >
                  <span>{connecting ? 'Connecting…' : 'Connect wallet'}</span>
                </button>
                {connectErr && <p className="text-sm text-danger">{connectErr.message}</p>}
              </div>
            )}

            {step === 'sign' && (
              <div className="space-y-5">
                <div className="eyebrow">Step 03 — Sign</div>
                <h2 className="font-display font-bold text-3xl text-ink leading-tight">
                  Sign to confirm
                </h2>
                <p className="text-ink-2">
                  One signature proves you own this wallet. No transaction. No gas.
                </p>
                <button onClick={handleSign} className="btn-primary">
                  <span>Sign and claim @{username}</span>
                  <span aria-hidden>→</span>
                </button>
              </div>
            )}

            {step === 'register' && (
              <div className="space-y-3">
                <div className="eyebrow">Step 04 — Register</div>
                <p className="font-display font-bold text-2xl md:text-3xl text-ink">
                  Reserving @{username}…
                </p>
                <div className="flex items-center gap-2 text-ink-3 text-sm">
                  <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                  <span>Writing to the database</span>
                </div>
              </div>
            )}

            {step === 'error' && (
              <div className="space-y-5">
                <div className="eyebrow text-danger">Something went wrong</div>
                <p className="text-ink-2">{message ?? 'Please try again.'}</p>
                <button
                  onClick={() => {
                    registeringRef.current = false;
                    setStep(isConnected && address ? 'sign' : 'connect');
                    setMessage(null);
                  }}
                  className="btn-bare"
                >
                  <span>Try again</span>
                </button>
              </div>
            )}
          </div>
        </section>
      </div>
    </>
  );
}

function Stepper({ current }: { current: Step }) {
  const order: { id: Step; label: string; desc: string }[] = [
    { id: 'checking', label: 'Check', desc: 'Confirm name is free' },
    { id: 'connect', label: 'Connect', desc: 'Bring your wallet' },
    { id: 'sign', label: 'Sign', desc: 'Prove it’s yours' },
    { id: 'register', label: 'Register', desc: 'Reserve it forever' },
  ];
  const currentIdx = order.findIndex((o) => o.id === current);
  return (
    <ol className="space-y-3">
      {order.map((s, i) => {
        const active = i === currentIdx;
        const done = currentIdx > i || current === 'done';
        return (
          <li
            key={s.id}
            className={`flex items-start gap-4 p-4 rounded-xl border transition-all ${
              active
                ? 'border-primary bg-primary-soft shadow-soft'
                : done
                  ? 'border-hairline bg-white'
                  : 'border-hairline/60 bg-white/50'
            }`}
          >
            <span
              className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm numeric ${
                active
                  ? 'bg-primary text-white'
                  : done
                    ? 'bg-success/15 text-success'
                    : 'bg-paper text-ink-4 border border-hairline'
              }`}
            >
              {done && !active ? '✓' : String(i + 1).padStart(2, '0')}
            </span>
            <div>
              <div
                className={`text-sm font-semibold ${
                  active ? 'text-ink' : done ? 'text-ink-2' : 'text-ink-3'
                }`}
              >
                {s.label}
              </div>
              <div className={`text-xs mt-0.5 ${active ? 'text-ink-2' : 'text-ink-4'}`}>
                {s.desc}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
