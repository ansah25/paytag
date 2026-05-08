'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import { ConnectWallet, DisconnectButton } from '@/components/ConnectWallet';
import { SignInPanel } from '@/components/SignInPanel';
import { RegisterForm } from '@/components/RegisterForm';
import { AddressManager } from '@/components/AddressManager';
import { CopyButton } from '@/components/CopyButton';
import { Avatar } from '@/components/Avatar';
import { GradientMesh } from '@/components/GradientMesh';
import { api, ResolveResponse } from '@/lib/api';
import { AuthState, clearAuth, getAuth } from '@/lib/auth';

const shortAddr = (addr: string) => `${addr.slice(0, 6)}…${addr.slice(-4)}`;

export default function AppPage() {
  const { address, isConnected } = useAccount();
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [origin, setOrigin] = useState('');
  const [resolution, setResolution] = useState<ResolveResponse | null>(null);

  useEffect(() => {
    setAuth(getAuth());
    setHydrated(true);
    if (typeof window !== 'undefined') setOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    if (!isConnected) {
      if (auth) {
        clearAuth();
        setAuth(null);
      }
      return;
    }
    if (auth && address && auth.wallet.toLowerCase() !== address.toLowerCase()) {
      clearAuth();
      setAuth(null);
    }
  }, [hydrated, isConnected, address, auth]);

  // Resolve the wallet's authoritative paytag from the server. The username is
  // a property of the wallet, not of the device — so on every dashboard visit
  // we re-check rather than trust whatever localStorage says.
  useEffect(() => {
    if (!auth?.token) return;
    let cancelled = false;
    api
      .me()
      .then((me) => {
        if (cancelled) return;
        setAuth((prev) =>
          prev ? { ...prev, username: me.username ?? undefined } : prev,
        );
      })
      .catch(() => {
        // Leave the cached state alone on transient errors; the
        // useAuthState hook handles 401 cleanup app-wide.
      });
    return () => {
      cancelled = true;
    };
  }, [auth?.token]);

  // Fetch resolution to compute "active networks" stat
  useEffect(() => {
    if (!auth?.username) {
      setResolution(null);
      return;
    }
    api.resolve(auth.username).then(setResolution).catch(() => setResolution(null));
  }, [auth?.username]);

  if (!hydrated) {
    return <div className="max-w-[1240px] mx-auto px-6 md:px-10 py-20 text-ink-3">Loading…</div>;
  }

  // === Pre-auth: connect ===
  if (!isConnected || !address) {
    return (
      <PreAuthShell>
        <div className="card p-8 md:p-10 max-w-md w-full">
          <div className="eyebrow mb-3">Welcome back</div>
          <h1 className="font-display font-bold text-3xl md:text-4xl text-ink mb-3 leading-tight">
            Connect a wallet
          </h1>
          <p className="text-ink-2 mb-7">
            Your wallet is your identity here. No password to remember, no account to
            forget.
          </p>
          <ConnectWallet />
        </div>
      </PreAuthShell>
    );
  }

  // === Pre-auth: sign in ===
  if (!auth) {
    return (
      <PreAuthShell>
        <div className="card p-8 md:p-10 max-w-md w-full">
          <div className="eyebrow mb-3">One more step</div>
          <h1 className="font-display font-bold text-3xl md:text-4xl text-ink mb-1 leading-tight">
            Prove it&apos;s you
          </h1>
          <div className="font-mono text-[13px] text-ink-3 numeric mb-6">
            {shortAddr(address)}
          </div>
          <SignInPanel wallet={address} onSignedIn={setAuth} />
        </div>
      </PreAuthShell>
    );
  }

  // === Wallet has no paytag yet — register inline ===
  // The server already told us this wallet owns nothing (via /me). The only
  // way forward is to claim a fresh name with this wallet — there's no
  // "load by typing it" path because a paytag belongs to a wallet, not to a
  // device.
  if (!auth.username) {
    return (
      <PreAuthShell>
        <div className="card p-8 md:p-10 max-w-md w-full">
          <div className="eyebrow mb-3">One last step</div>
          <h1 className="font-display font-bold text-3xl md:text-4xl text-ink mb-3 leading-tight">
            Claim your paytag
          </h1>
          <p className="text-ink-2 mb-6">
            This wallet doesn&apos;t have a paytag yet. Pick a name and it&apos;ll
            be permanently linked to{' '}
            <span className="font-mono text-ink-3 numeric">{shortAddr(address)}</span>.
          </p>
          <RegisterForm
            onRegistered={(username) => setAuth({ ...auth, username })}
          />
        </div>
      </PreAuthShell>
    );
  }

  // === Authenticated dashboard ===
  const payLink = `${origin || ''}/${auth.username}`;
  const displayLink = origin
    ? `${origin.replace(/^https?:\/\//, '')}/${auth.username}`
    : `/${auth.username}`;
  const activeNetworks = resolution
    ? Object.values(resolution.addresses).filter(Boolean).length
    : 0;

  return (
    <>
      {/* Header band */}
      <section className="relative overflow-hidden border-b border-hairline">
        <GradientMesh intensity="soft" />
        <div className="relative max-w-[1240px] mx-auto px-6 md:px-10 pt-14 pb-12">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 animate-rise rise-1">
            <div className="flex items-center gap-5">
              <Avatar username={auth.username} size={72} />
              <div>
                <div className="eyebrow mb-2">Your paytag</div>
                <h1 className="font-display font-bold text-4xl md:text-6xl text-ink leading-none tracking-tightish">
                  @{auth.username}
                </h1>
              </div>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <div className="bg-white/80 backdrop-blur border border-hairline rounded-full px-3 py-1.5 font-mono text-ink-2 numeric">
                {shortAddr(address)}
              </div>
              <DisconnectButton />
            </div>
          </div>

          {/* Stats */}
          <div className="mt-10 grid grid-cols-3 gap-4 max-w-2xl animate-rise rise-2">
            {[
              { l: 'Active networks', v: `${activeNetworks}/3` },
              { l: 'Length', v: `${auth.username.length}` },
              { l: 'Cost', v: '$0' },
            ].map((s) => (
              <div
                key={s.l}
                className="bg-white/80 backdrop-blur border border-hairline rounded-2xl p-4"
              >
                <div className="font-display font-bold text-3xl md:text-4xl text-ink leading-none numeric">
                  {s.v}
                </div>
                <div className="eyebrow-muted mt-2">{s.l}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="max-w-[1240px] mx-auto px-6 md:px-10 py-12 md:py-16 grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8">
        {/* Send CTA */}
        <Link
          href="/send"
          className="lg:col-span-3 group relative overflow-hidden rounded-2xl p-7 md:p-9 text-white animate-rise rise-1"
          style={{
            background:
              'linear-gradient(135deg, #5469D4 0%, #7E5CFF 50%, #FF5A6E 100%)',
            boxShadow:
              '0 12px 28px -8px rgba(84,105,212,0.45), 0 24px 48px -12px rgba(126,92,255,0.35)',
          }}
        >
          <div
            aria-hidden
            className="absolute -right-20 -top-20 w-72 h-72 rounded-full bg-white/15 blur-3xl"
          />
          <div className="relative flex items-center justify-between gap-6">
            <div>
              <div className="text-[11.5px] font-bold uppercase tracking-eyebrow text-white/70 mb-2">
                Primary action
              </div>
              <div className="font-display font-bold text-3xl md:text-5xl leading-tight tracking-tightish">
                Send money
              </div>
              <div className="mt-2 text-white/75 max-w-md">
                Pay any @paytag with one click. Auto-resolves and lets you pick the
                network.
              </div>
            </div>
            <div className="hidden md:flex items-center justify-center w-16 h-16 rounded-full bg-white/15 backdrop-blur text-2xl group-hover:bg-white/25 transition-colors">
              →
            </div>
          </div>
        </Link>

        {/* Receive */}
        <section className="lg:col-span-2 card p-7 md:p-9 animate-rise rise-2">
          <div className="flex items-center justify-between mb-5">
            <div>
              <div className="eyebrow mb-2">Receive</div>
              <h2 className="font-display font-bold text-2xl md:text-3xl text-ink">
                Share your link
              </h2>
            </div>
            <CopyButton value={payLink} label="Copy link" variant="pill" />
          </div>
          <div className="bg-paper border border-hairline rounded-xl p-4 font-mono text-sm md:text-base text-ink break-all numeric">
            {displayLink}
          </div>
          <div className="mt-5 flex items-center gap-4 text-sm">
            <Link
              href={`/${auth.username}`}
              className="text-primary font-semibold hover:underline underline-offset-4"
            >
              Open public page →
            </Link>
            <span className="text-ink-4">·</span>
            <span className="text-ink-3">Works on any device, no install needed.</span>
          </div>
        </section>

        {/* Tip card */}
        <section
          className="card p-7 md:p-9 relative overflow-hidden animate-rise rise-3"
          style={{
            background:
              'linear-gradient(180deg, #F6F9FC 0%, #ffffff 100%)',
          }}
        >
          <div
            aria-hidden
            className="absolute -right-10 -top-10 w-32 h-32 rounded-full opacity-15 blur-2xl"
            style={{ background: '#FFB547' }}
          />
          <div className="eyebrow-muted mb-3">Tip</div>
          <h3 className="font-display font-bold text-xl text-ink mb-2 leading-snug">
            Add Solana &amp; Bitcoin addresses to receive on every chain.
          </h3>
          <p className="text-ink-2 text-sm">
            Your @paytag works across networks — but each chain needs its own address. Add
            them below.
          </p>
        </section>

        {/* Wallets */}
        <section className="lg:col-span-3 animate-rise rise-4">
          <div className="flex items-baseline justify-between mb-4">
            <div>
              <div className="eyebrow mb-2">Wallets</div>
              <h2 className="font-display font-bold text-2xl md:text-3xl text-ink">
                Mapped addresses
              </h2>
            </div>
            <span className="text-sm text-ink-3 numeric">{activeNetworks} of 3 active</span>
          </div>
          <AddressManager username={auth.username} />
        </section>
      </div>
    </>
  );
}

function PreAuthShell({ children }: { children: React.ReactNode }) {
  return (
    <section className="relative overflow-hidden">
      <GradientMesh intensity="soft" />
      <div className="relative max-w-[1240px] mx-auto px-6 md:px-10 py-20 md:py-32 flex justify-center">
        {children}
      </div>
    </section>
  );
}
