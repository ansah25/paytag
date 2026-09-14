'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import { ConnectWallet, DisconnectButton } from '@/components/ConnectWallet';
import { SignInPanel } from '@/components/SignInPanel';
import { AddressManager } from '@/components/AddressManager';
import { CopyButton } from '@/components/CopyButton';
import { Avatar } from '@/components/Avatar';
import { api, ResolveResponse } from '@/lib/api';
import { AuthState, clearAuth, getAuth } from '@/lib/auth';

const shortAddr = (addr: string) => `${addr.slice(0, 6)}…${addr.slice(-4)}`;

export default function AppPage() {
  // `status` settles to 'connected' or 'disconnected' once wagmi has finished
  // its reconnect-from-storage on mount. Until then it's 'connecting' or
  // 'reconnecting' — and `isConnected` is `false` during that window even
  // though the user is logged in. Acting on `!isConnected` alone wipes a
  // valid session on every refresh; gate on `status === 'disconnected'`.
  const { address, status } = useAccount();
  const isReconnecting = status === 'connecting' || status === 'reconnecting';
  const isConnected = status === 'connected';
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [origin, setOrigin] = useState('');
  const [resolution, setResolution] = useState<ResolveResponse | null>(null);
  const [createdAt, setCreatedAt] = useState<string | null>(null);

  useEffect(() => {
    setAuth(getAuth());
    setHydrated(true);
    if (typeof window !== 'undefined') setOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    // Only treat the wallet as gone once wagmi has settled — otherwise we'd
    // clear auth during the reconnect window and force a re-sign on refresh.
    if (status === 'disconnected') {
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
  }, [hydrated, status, address, auth]);

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
        setCreatedAt(me.createdAt);
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

  // While wagmi is restoring the wallet from storage, hold the page instead
  // of flashing the "Connect a wallet" shell — otherwise refreshing the
  // dashboard looks like a forced sign-out.
  if (isReconnecting) {
    return (
      <div className="max-w-[1240px] mx-auto px-6 md:px-10 py-20 text-ink-3">
        Restoring session…
      </div>
    );
  }

  // === Pre-auth: connect ===
  if (!isConnected || !address) {
    return (
      <PreAuthShell>
        <div className="card card-hover p-8 md:p-10 max-w-md w-full relative overflow-hidden">
          <div className="relative">
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
        </div>
      </PreAuthShell>
    );
  }

  // === Pre-auth: sign in ===
  if (!auth) {
    return (
      <PreAuthShell>
        <div className="card card-hover p-8 md:p-10 max-w-md w-full relative overflow-hidden">
          <div className="relative">
            <div className="eyebrow mb-3">One more step</div>
            <h1 className="font-display font-bold text-3xl md:text-4xl text-ink mb-1 leading-tight">
              Prove it&apos;s you
            </h1>
            <div className="font-mono text-[13px] text-ink-3 numeric mb-6">
              {shortAddr(address)}
            </div>
            <SignInPanel wallet={address} onSignedIn={setAuth} />
          </div>
        </div>
      </PreAuthShell>
    );
  }

  // === Wallet has no paytag yet ===
  // Registration now lives in the claim wizard's pick step (/claim). This gate
  // is restyled in step 6.
  if (!auth.username) {
    return (
      <PreAuthShell>
        <div className="max-w-md w-full border border-line p-8 md:p-10">
          <div className="mb-3">Almost there</div>
          <h1 className="font-display font-bold text-3xl md:text-4xl text-ink mb-3 leading-tight">
            This wallet has no paytag yet
          </h1>
          <p className="text-ink2 mb-6">
            Pick a name and it&apos;ll be linked to{' '}
            <span className="font-mono">{shortAddr(address)}</span>.
          </p>
          <Link href="/claim" className="text-accent font-semibold">
            Choose a name →
          </Link>
        </div>
      </PreAuthShell>
    );
  }

  // === Authenticated dashboard ===
  const payLink = `${origin || ''}/${auth.username}`;
  const displayHost = origin ? origin.replace(/^https?:\/\//, '') : 'paytag.dev';
  const shareText = `Pay me with @${auth.username} on Paytag`;
  const shareIntents = {
    x: `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(payLink)}`,
    whatsapp: `https://wa.me/?text=${encodeURIComponent(`${shareText} ${payLink}`)}`,
    sms: `sms:?&body=${encodeURIComponent(`${shareText} ${payLink}`)}`,
    email: `mailto:?subject=${encodeURIComponent('Pay me on Paytag')}&body=${encodeURIComponent(`${shareText}\n\n${payLink}`)}`,
  };
  const activeNetworks = resolution
    ? Object.values(resolution.addresses).filter(Boolean).length
    : 0;
  // "May 2026"-style label. Falls back to an em-dash while /me is in flight so
  // the stat tile keeps its size and the layout doesn't shift on hydrate.
  const memberSince = createdAt
    ? new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric' }).format(
        new Date(createdAt),
      )
    : '—';
  const chainSteps = [
    { chain: 'ethereum' as const, label: 'Add Ethereum address', done: !!resolution?.addresses.ethereum },
    { chain: 'solana' as const, label: 'Add Solana address', done: !!resolution?.addresses.solana },
    { chain: 'bitcoin' as const, label: 'Add Bitcoin address', done: !!resolution?.addresses.bitcoin },
  ];
  const allChainsDone = resolution !== null && chainSteps.every((s) => s.done);

  return (
    <>
      {/* Header band */}
      <section className="relative overflow-hidden">
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
          <div className="mt-10 grid grid-cols-2 gap-4 max-w-xl animate-rise rise-2">
            {[
              { l: 'Active networks', v: `${activeNetworks}/3` },
              { l: 'Member since', v: memberSince },
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
        {/* Hero Receive — the dashboard's anchor. The link itself is the
            visual: hostname in muted ink, username in the brand gradient. */}
        <section className="lg:col-span-2 card card-hover p-7 md:p-9 animate-rise rise-1 relative overflow-hidden">
          <div className="relative">
            <div className="eyebrow mb-2">Receive</div>
            <h2 className="font-display font-bold text-2xl md:text-3xl text-ink mb-1">
              Share to get paid
            </h2>
            <p className="text-ink-3 text-sm mb-6 max-w-md">
              Anyone can send you crypto with this one link. No install, no
              extension, no copy-paste.
            </p>

            {/* Stylized link — username gets the brand gradient */}
            <div className="rounded-2xl border-2 border-hairline bg-paper/60 p-6 md:p-8 mb-5">
              <div className="font-display font-bold text-3xl md:text-5xl leading-tight tracking-tightish break-all">
                <span className="text-ink-3">{displayHost}/</span>
                <span
                  className="bg-clip-text text-transparent"
                  style={{
                    backgroundImage:
                      'linear-gradient(110deg, #5469D4 0%, #7E5CFF 35%, #FF5A6E 75%, #FFB547 100%)',
                  }}
                >
                  {auth.username}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <CopyButton value={payLink} label="Copy link" variant="pill" />
              <ShareButton href={shareIntents.x} label="Share on X" />
              <ShareButton href={shareIntents.whatsapp} label="WhatsApp" />
              <ShareButton href={shareIntents.sms} label="iMessage" />
              <ShareButton href={shareIntents.email} label="Email" />
            </div>

            <div className="mt-5">
              <Link
                href={`/${auth.username}`}
                className="text-primary font-semibold text-sm hover:underline underline-offset-4"
              >
                Open public page →
              </Link>
            </div>
          </div>
        </section>

        {/* Setup checklist — replaces the static Tip card. Items reflect the
            current resolution; once all chains are mapped the card morphs to
            an "all set" state instead of nagging. */}
        <section className="card card-hover p-7 md:p-9 relative overflow-hidden animate-rise rise-2">
          <div className="relative">
          <div className="eyebrow-muted mb-3">Setup</div>
          {allChainsDone ? (
            <>
              <h3 className="font-display font-bold text-xl text-ink mb-2 leading-snug">
                You&apos;re all set.
              </h3>
              <p className="text-ink-2 text-sm">
                Every chain is live. Share your link and start getting paid.
              </p>
            </>
          ) : (
            <>
              <h3 className="font-display font-bold text-xl text-ink mb-4 leading-snug">
                Finish setting up
              </h3>
              <ul className="space-y-3">
                <ChecklistItem done label="Claim your name" hint={`@${auth.username}`} />
                {chainSteps.map((s) => (
                  <ChecklistItem
                    key={s.chain}
                    done={s.done}
                    label={s.label}
                    hint={s.done ? undefined : 'Add it below.'}
                  />
                ))}
              </ul>
            </>
          )}
          </div>
        </section>

        {/* Wallets */}
        <section className="lg:col-span-3 animate-rise rise-3">
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

function ShareButton({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="btn-bare !py-2 !px-4 !text-[13px]"
    >
      <span>{label}</span>
    </a>
  );
}

function ChecklistItem({
  done,
  label,
  hint,
}: {
  done: boolean;
  label: string;
  hint?: string;
}) {
  return (
    <li className="flex items-start gap-3">
      <span
        aria-hidden
        className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5 ${
          done
            ? 'bg-success/15 text-success'
            : 'bg-paper border border-hairline text-ink-4'
        }`}
      >
        {done ? '✓' : ''}
      </span>
      <div className="min-w-0">
        <div className={`text-sm font-semibold ${done ? 'text-ink' : 'text-ink-2'}`}>
          {label}
        </div>
        {hint && <div className="text-xs text-ink-3 mt-0.5 truncate">{hint}</div>}
      </div>
    </li>
  );
}

function PreAuthShell({ children }: { children: React.ReactNode }) {
  return (
    <section className="relative overflow-hidden">
      <div className="relative max-w-[1240px] mx-auto px-6 md:px-10 py-20 md:py-32 flex justify-center">
        {children}
      </div>
    </section>
  );
}
