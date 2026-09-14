'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useAccount, useConnect, useDisconnect, useSignMessage } from 'wagmi';
import { ClaimInput, SuggestionChip } from '@/components/ClaimInput';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Notice } from '@/components/ui/Notice';
import { PulseDot } from '@/components/ui/Skeleton';
import {
  api,
  ApiError,
  buildSignMessage,
  type AvailabilityResponse,
  type MeResponse,
  type ResolveResponse,
} from '@/lib/api';
import { clearAuth, getAuth, saveAuth, updateAuth } from '@/lib/auth';
import { cx } from '@/lib/cx';
import { shortAddress } from '@/lib/format';
import { walletErrorMessage } from '@/lib/pay/errors';
import { ClaimDone } from './ClaimDone';

type Step =
  | 'checking'
  | 'pick'
  | 'unavailable'
  | 'connect'
  | 'resuming'
  | 'sign'
  | 'register'
  | 'wallet_taken'
  | 'error'
  | 'done';

const STEPS = [
  { label: 'Name', desc: 'Check it’s free' },
  { label: 'Connect', desc: 'Bring your wallet' },
  { label: 'Sign', desc: 'Prove it’s yours' },
  { label: 'Register', desc: 'Link it forever' },
];

const STEP_INDEX: Record<Exclude<Step, 'error'>, number> = {
  checking: 0,
  pick: 0,
  unavailable: 0,
  connect: 1,
  resuming: 2,
  sign: 2,
  wallet_taken: 2,
  register: 3,
  done: 4,
};

const NO_WALLET = 'No browser wallet detected.';

type UnavailableReason = NonNullable<AvailabilityResponse['reason']>;

interface Props {
  /** Omit for the pick step (/claim). */
  username?: string;
}

export function ClaimWizard({ username: routeName }: Props) {
  const router = useRouter();
  const username = routeName ? routeName.toLowerCase() : null;
  const { address, status: walletStatus } = useAccount();
  const { connectors, connectAsync } = useConnect();
  const { disconnect } = useDisconnect();
  const { signMessageAsync } = useSignMessage();

  const [step, setStep] = useState<Step>(username ? 'checking' : 'pick');
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState<{ message: string; at: number } | null>(null);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState<{ reason: UnavailableReason; suggestions: string[] } | null>(null);
  const [existing, setExisting] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [signing, setSigning] = useState(false);
  const [noWallet, setNoWallet] = useState(false);
  const [draft, setDraft] = useState('');
  const [done, setDone] = useState<{ createdAt: string | null; resolution: ResolveResponse | null | 'loading' }>({
    createdAt: null,
    resolution: 'loading',
  });

  const mounted = useRef(true);
  const registering = useRef(false);
  const resumedFor = useRef<string | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const connected = walletStatus === 'connected' && !!address;
  const shownName = username ?? (draft || 'yourname');

  const fail = useCallback((message: string, at: number) => {
    setError({ message, at });
    setStep('error');
  }, []);

  const showDone = useCallback(
    async (name: string, createdAt: string | null) => {
      setDone({ createdAt, resolution: 'loading' });
      setStep('done');
      // Keep the success view on refresh; ?done=1 is re-verified against /me.
      router.replace(`/claim/${name}?done=1`, { scroll: false });
      try {
        const resolution = await api.resolve(name);
        if (mounted.current) setDone({ createdAt, resolution });
      } catch {
        if (mounted.current) setDone({ createdAt, resolution: null });
      }
    },
    [router],
  );

  /** After a session exists: done, wallet_taken, or register. */
  const routeByOwnership = useCallback(
    async (me: MeResponse) => {
      if (!username) return;
      if (me.username === username) {
        updateAuth({ username });
        await showDone(username, me.createdAt);
      } else if (me.username) {
        updateAuth({ username: me.username });
        setExisting(me.username);
        setStep('wallet_taken');
      } else {
        setStep('register');
      }
    },
    [username, showDone],
  );

  useEffect(() => {
    setNoWallet(!(window as Window & { ethereum?: unknown }).ethereum);
  }, []);

  // Named route: the wallet may already own this exact name (retry, refresh,
  // old /welcome link) — otherwise check availability.
  useEffect(() => {
    if (!username) return;
    let cancelled = false;
    (async () => {
      if (getAuth()?.token) {
        try {
          const me = await api.me();
          if (cancelled) return;
          if (me.username === username) {
            updateAuth({ username });
            await showDone(username, me.createdAt);
            return;
          }
        } catch {
          // Expired or offline session — fall through to the normal flow.
        }
      }
      try {
        const res = await api.available(username);
        if (cancelled) return;
        if (res.available) {
          setStep('connect');
        } else {
          setUnavailable({ reason: res.reason ?? 'TAKEN', suggestions: res.suggestions });
          setStep('unavailable');
        }
      } catch (err) {
        if (!cancelled) fail(err instanceof ApiError ? err.message : 'Couldn’t check availability.', 0);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [username, attempt, showDone, fail]);

  // Pick route: a wallet that already owns a name can't claim another.
  useEffect(() => {
    if (username || !getAuth()?.token) return;
    let cancelled = false;
    api
      .me()
      .then((me) => {
        if (!cancelled && me.username) {
          setExisting(me.username);
          setStep('wallet_taken');
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [username]);

  // connect → sign once a wallet is available. If that wallet already has a
  // session, skip the signature and ask /me what it owns.
  useEffect(() => {
    if (step === 'sign' && walletStatus === 'disconnected') {
      setStep('connect');
      return;
    }
    if (step !== 'connect' || !connected || !address) return;
    setInlineError(null);
    const auth = getAuth();
    if (auth?.token && auth.wallet.toLowerCase() === address.toLowerCase() && resumedFor.current !== address) {
      resumedFor.current = address;
      setStep('resuming');
      api
        .me()
        .then((me) => {
          if (mounted.current) return routeByOwnership(me);
        })
        .catch((err) => {
          if (!mounted.current) return;
          if (err instanceof ApiError && err.status === 401) clearAuth();
          setStep('sign');
        });
      return;
    }
    setStep('sign');
  }, [step, connected, address, walletStatus, routeByOwnership]);

  useEffect(() => {
    if (step !== 'register' || !username || registering.current) return;
    registering.current = true;
    (async () => {
      try {
        const result = await api.register(username);
        updateAuth({ username: result.username });
        if (mounted.current) await showDone(result.username, result.createdAt);
      } catch (err) {
        if (!mounted.current) return;
        const code = err instanceof ApiError ? err.code : '';
        if (code === 'USERNAME_TAKEN' || code === 'USERNAME_RESERVED' || code === 'USERNAME_INVALID_FORMAT') {
          // Lost a race (or the name was never valid) — offer alternatives.
          const res = await api.available(username).catch(() => null);
          setUnavailable({
            reason:
              res?.reason ??
              (code === 'USERNAME_RESERVED' ? 'RESERVED' : code === 'USERNAME_INVALID_FORMAT' ? 'INVALID_FORMAT' : 'TAKEN'),
            suggestions: res?.suggestions ?? [],
          });
          setStep('unavailable');
        } else if (code === 'WALLET_HAS_USERNAME') {
          const me = await api.me().catch(() => null);
          if (me?.username) {
            updateAuth({ username: me.username });
            setExisting(me.username);
            setStep('wallet_taken');
          } else {
            fail('This wallet already has a paytag.', 3);
          }
        } else if (err instanceof ApiError && err.status === 401) {
          setInlineError('Your session expired. Sign again to continue.');
          setStep('sign');
        } else {
          fail(
            err instanceof ApiError
              ? err.message
              : 'The registry didn’t respond in time. Nothing was written — you can safely retry.',
            3,
          );
        }
      } finally {
        registering.current = false;
      }
    })();
  }, [step, username, showDone, fail]);

  const handleConnect = async () => {
    setInlineError(null);
    const injected = connectors.find((c) => c.type === 'injected') ?? connectors[0];
    if (!injected) {
      setNoWallet(true);
      return;
    }
    setConnecting(true);
    try {
      await connectAsync({ connector: injected });
    } catch (err) {
      const message = walletErrorMessage(err, {
        rejected: 'Connection was rejected in the wallet.',
        notFound: NO_WALLET,
        fallback: 'Couldn’t connect to your wallet.',
      });
      if (message === NO_WALLET) setNoWallet(true);
      else setInlineError(message);
    } finally {
      setConnecting(false);
    }
  };

  const handleSign = async () => {
    if (!address) return;
    setInlineError(null);
    setSigning(true);
    try {
      let nonce: string;
      try {
        ({ nonce } = await api.getNonce(address));
      } catch (err) {
        fail(err instanceof ApiError ? err.message : 'Couldn’t start sign-in.', 2);
        return;
      }
      let signature: string;
      try {
        signature = await signMessageAsync({ message: buildSignMessage(nonce) });
      } catch (err) {
        // Wallet errors stay on the sign step; only API failures go to error.
        setInlineError(
          walletErrorMessage(err, {
            rejected: 'Signature was rejected.',
            fallback: 'The wallet didn’t return a signature.',
          }),
        );
        return;
      }
      try {
        const { token, wallet } = await api.verify(address, signature);
        saveAuth({ token, wallet });
        resumedFor.current = address;
        const me = await api.me();
        if (mounted.current) await routeByOwnership(me);
      } catch (err) {
        fail(err instanceof ApiError ? err.message : 'Couldn’t verify the signature.', 2);
      }
    } finally {
      if (mounted.current) setSigning(false);
    }
  };

  const useAnotherWallet = () => {
    clearAuth();
    disconnect();
    resumedFor.current = null;
    setExisting(null);
    setInlineError(null);
    setStep(username ? 'connect' : 'pick');
  };

  const retry = () => {
    const at = error?.at ?? 0;
    setError(null);
    if (at === 0) {
      setStep('checking');
      setAttempt((n) => n + 1);
    } else if (at === 3 && getAuth()?.token) {
      setStep('register');
    } else {
      setStep(connected ? 'sign' : 'connect');
    }
  };

  if (step === 'done' && username) {
    return <ClaimDone username={username} createdAt={done.createdAt} resolution={done.resolution} />;
  }

  const currentIndex = step === 'error' ? error?.at ?? 0 : STEP_INDEX[step];
  let body: ReactNode;

  switch (step) {
    case 'checking':
    case 'resuming':
      body = (
        <div role="status" className="flex items-center gap-2.5 text-base text-ink2">
          <PulseDot />
          {step === 'checking' ? 'Checking availability…' : 'Checking your wallet session…'}
        </div>
      );
      break;

    case 'pick':
      body = (
        <div className="grid gap-[18px]">
          <StepHeading kicker="Step 1 · Name" title="Pick your name">
            It will be linked to{' '}
            {connected && address ? (
              <span className="font-mono text-ink">{shortAddress(address)}</span>
            ) : (
              'the wallet you connect next'
            )}
            . One name per wallet.
          </StepHeading>
          <ClaimInput
            size="lg"
            surface="surface2"
            submitLabel="Continue"
            onSubmitName={(name) => router.push(`/claim/${name}`)}
            onValueChange={setDraft}
            autoFocus
          />
        </div>
      );
      break;

    case 'unavailable': {
      const reason = unavailable?.reason ?? 'TAKEN';
      const suggestions = unavailable?.suggestions ?? [];
      body = (
        <div className="grid gap-[18px]">
          <StepHeading
            kicker="Unavailable"
            tone="danger"
            title={
              reason === 'RESERVED'
                ? `@${username} is reserved.`
                : reason === 'INVALID_FORMAT'
                  ? `@${username} isn’t a valid name.`
                  : `@${username} is already taken.`
            }
          >
            {reason === 'INVALID_FORMAT' ? 'Names are 3–20 lowercase letters, numbers or underscores.' : null}
          </StepHeading>
          {suggestions.length > 0 && (
            <div>
              <div className="mb-2.5 text-[13px] font-semibold text-ink2">Try one of these</div>
              <div className="flex flex-wrap gap-2">
                {suggestions.map((s) => (
                  <SuggestionChip key={s} href={`/claim/${s}`}>
                    @{s}
                  </SuggestionChip>
                ))}
              </div>
            </div>
          )}
          <Button variant="outline" href="/claim" className="justify-self-start">
            Choose a different name
          </Button>
        </div>
      );
      break;
    }

    case 'connect':
      body = (
        <div className="grid gap-[18px]">
          <StepHeading kicker="Step 2 · Connect" title="Connect a wallet">
            This becomes your default Ethereum address. Paytag only ever stores the public address.
          </StepHeading>
          <div className="flex flex-wrap items-center gap-2.5">
            <Button
              size={48}
              loading={connecting || walletStatus === 'connecting' || walletStatus === 'reconnecting'}
              loadingLabel="Connecting…"
              onClick={() => void handleConnect()}
            >
              Connect wallet
            </Button>
            {inlineError && (
              <span role="alert" className="text-sm font-medium text-danger">
                {inlineError}
              </span>
            )}
          </div>
          {noWallet && (
            <Notice tone="warn">
              No browser wallet detected. Install MetaMask, Rabby or another injected wallet and reload.
            </Notice>
          )}
        </div>
      );
      break;

    case 'sign':
      body = (
        <div className="grid gap-[18px]">
          <StepHeading kicker="Step 3 · Sign" title="Prove it’s your wallet">
            One message signature. No transaction, no gas, nothing leaves your wallet.
          </StepHeading>
          <div className="rounded-inset bg-surface2 px-[18px] py-3.5 font-mono text-[13px] leading-[1.6] text-ink2">
            Paytag authentication
            <br />
            Wallet: <span className="text-ink">{address ? shortAddress(address) : '—'}</span>
            <br />
            Nonce: <span className="text-ink">single-use, issued when you sign</span>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <Button
              size={48}
              loading={signing}
              loadingLabel="Waiting for signature…"
              onClick={() => void handleSign()}
              className="max-w-full"
            >
              <span className="min-w-0 truncate">Sign and claim @{username}</span>
            </Button>
            {inlineError && (
              <span role="alert" className="text-sm font-medium text-danger">
                {inlineError}
              </span>
            )}
          </div>
        </div>
      );
      break;

    case 'register':
      body = (
        <div className="grid gap-3.5">
          <div className="text-[13px] font-semibold text-accent">Step 4 · Register</div>
          <h2 className="break-words font-display text-[30px] font-semibold leading-[1.15] tracking-display-md">
            Reserving @{username}…
          </h2>
          <div role="status" className="flex items-center gap-2.5 text-sm text-ink2">
            <PulseDot />
            Linking the name to your wallet
          </div>
        </div>
      );
      break;

    case 'wallet_taken':
      body = (
        <div className="grid gap-[18px]">
          <StepHeading kicker="Already linked" tone="warn" title={`This wallet already owns @${existing}`}>
            A wallet can hold one paytag. {username ? `To claim @${username} as well` : 'To claim another name'},
            connect a different wallet. Otherwise, your dashboard for @{existing} is ready.
          </StepHeading>
          <div className="flex flex-wrap gap-2">
            <Button size={48} variant="solid" href="/app">
              Open dashboard
            </Button>
            <Button size={48} variant="outline" onClick={useAnotherWallet}>
              Use another wallet
            </Button>
          </div>
        </div>
      );
      break;

    case 'error':
      body = (
        <div className="grid gap-[18px]">
          <StepHeading kicker="Something went wrong" tone="danger" title="We couldn’t finish that step">
            {error?.message}
          </StepHeading>
          <div className="flex flex-wrap gap-2">
            <Button size={48} onClick={retry}>
              Try again
            </Button>
            <Button size={48} variant="outline" href="/">
              Back home
            </Button>
          </div>
        </div>
      );
      break;
  }

  return (
    <section className="mx-auto w-full max-w-content px-6 pb-24 pt-14">
      <div className="flex animate-enter items-center gap-4">
        <span
          aria-hidden
          className="inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-line bg-surface2 font-display text-2xl font-bold text-accent"
        >
          {username || draft ? shownName.charAt(0) : '@'}
        </span>
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-ink2">Claiming</div>
          <h1 className="mt-1 break-all font-display text-[clamp(32px,4.5vw,52px)] font-semibold leading-none tracking-display-lg">
            @{shownName}
          </h1>
        </div>
      </div>

      <div className="mt-10 flex flex-wrap items-start gap-5">
        <Stepper current={currentIndex} />
        <Card
          padding="none"
          className="flex min-h-[300px] flex-[2_1_420px] animate-enter flex-col justify-center p-[clamp(24px,4vw,40px)] [animation-delay:100ms]"
        >
          <div key={step} className="animate-stage">
            {body}
          </div>
        </Card>
      </div>
    </section>
  );
}

function Stepper({ current }: { current: number }) {
  return (
    <ol aria-label="Claim progress" className="grid flex-[1_1_260px] animate-enter gap-1.5 [animation-delay:50ms]">
      {STEPS.map((s, i) => {
        const active = i === current;
        const complete = i < current;
        return (
          <li
            key={s.label}
            aria-current={active ? 'step' : undefined}
            className={cx(
              'flex items-center gap-3.5 rounded-inset border px-4 py-3.5',
              active ? 'border-line2 bg-surface' : 'border-transparent',
            )}
          >
            <span
              aria-hidden
              className={cx(
                'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold',
                active ? 'bg-accent text-on-accent' : complete ? 'bg-ok-bg text-ok' : 'bg-surface2 text-ink3',
              )}
            >
              {complete ? '✓' : i + 1}
            </span>
            <div className="min-w-0">
              <div className={cx('text-[15px] font-bold', active ? 'text-ink' : complete ? 'text-ink2' : 'text-ink3')}>
                {s.label}
                <span className="sr-only">{complete ? ' (done)' : active ? ' (current step)' : ''}</span>
              </div>
              <div className="mt-px text-[13px] text-ink3">{s.desc}</div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

const KICKER_TONE = { accent: 'text-accent', danger: 'text-danger', warn: 'text-warn' } as const;

function StepHeading({
  kicker,
  tone = 'accent',
  title,
  children,
}: {
  kicker: string;
  tone?: keyof typeof KICKER_TONE;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div>
      <div className={cx('text-[13px] font-semibold', KICKER_TONE[tone])}>{kicker}</div>
      <h2 className="mt-2 break-words font-display text-[30px] font-semibold leading-[1.15] tracking-display-md">
        {title}
      </h2>
      {children && <p className="mt-2.5 max-w-[480px] text-[15px] leading-[1.55] text-ink2">{children}</p>}
    </div>
  );
}
