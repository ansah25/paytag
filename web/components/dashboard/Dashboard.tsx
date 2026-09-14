'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAccount, useConnect, useDisconnect, useSignMessage } from 'wagmi';
import { Button } from '@/components/ui/Button';
import { SegmentedRail, type RailItem } from '@/components/ui/SegmentedRail';
import { Skeleton, SkeletonStatus } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { api, ApiError, buildSignMessage, type MeResponse, type ResolveResponse } from '@/lib/api';
import { clearAuth, getAuth, saveAuth, subscribeAuth, syncAuthWithServer, type AuthState } from '@/lib/auth';
import { shortAddress } from '@/lib/format';
import { walletErrorMessage } from '@/lib/pay/errors';
import { CHAIN_ORDER } from '@/lib/pay/meta';
import { Activity } from './Activity';
import { AddressManager } from './AddressManager';
import { GateCard } from './GateCard';
import { ProfileForm } from './ProfileForm';
import { ReceiveCard } from './ReceiveCard';
import { Sessions } from './Sessions';
import { SetupCard } from './SetupCard';

type Tab = 'overview' | 'profile' | 'settings';

const TABS: RailItem<Tab>[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'profile', label: 'Profile' },
  { id: 'settings', label: 'Settings' },
];

const isTab = (value: string | null): value is Tab =>
  value === 'overview' || value === 'profile' || value === 'settings';

const NO_WALLET = 'No browser wallet detected.';

export function Dashboard() {
  // `status` settles to 'connected' or 'disconnected' once wagmi has finished
  // its reconnect-from-storage on mount. Until then it's 'connecting' or
  // 'reconnecting' — acting on "not connected" in that window would wipe a
  // valid session on every refresh.
  const { address, status } = useAccount();
  const { connectors, connectAsync } = useConnect();
  const { disconnect } = useDisconnect();
  const { signMessageAsync } = useSignMessage();
  const toast = useToast();

  const [hydrated, setHydrated] = useState(false);
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [meSettled, setMeSettled] = useState(false);
  const [resolution, setResolution] = useState<ResolveResponse | null>(null);
  const [activityCount, setActivityCount] = useState(0);
  const [tab, setTab] = useState<Tab>('overview');
  const [busy, setBusy] = useState<'connecting' | 'signing' | null>(null);
  const [gateError, setGateError] = useState<string | null>(null);
  const [noWallet, setNoWallet] = useState(false);

  useEffect(() => {
    setAuth(getAuth());
    setHydrated(true);
    setNoWallet(!(window as Window & { ethereum?: unknown }).ethereum);
    const initialTab = new URLSearchParams(window.location.search).get('tab');
    if (isTab(initialTab)) setTab(initialTab);
    // Header sign-out, the claim wizard and other tabs all write auth.
    return subscribeAuth(() => setAuth(getAuth()));
  }, []);

  // Clear the session when the wallet disconnects or switches account.
  useEffect(() => {
    if (!hydrated || !auth) return;
    const switched = !!address && auth.wallet.toLowerCase() !== address.toLowerCase();
    if (status === 'disconnected' || switched) clearAuth();
  }, [hydrated, status, address, auth]);

  // /me is the source of truth for which name this wallet owns.
  const token = auth?.token;
  useEffect(() => {
    setMe(null);
    setMeSettled(false);
    if (!token) return;
    let cancelled = false;
    api
      .me()
      .then((result) => {
        if (cancelled) return;
        setMe(result);
        syncAuthWithServer(result);
      })
      .catch(() => {
        // Transient errors keep the cached state; api.ts clears auth on 401.
      })
      .finally(() => {
        if (!cancelled) setMeSettled(true);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const username = auth?.username;
  const refreshResolution = useCallback(async () => {
    if (!username) return;
    try {
      setResolution(await api.resolve(username));
    } catch {
      // Keep the last good resolution on a failed refresh.
    }
  }, [username]);

  useEffect(() => {
    setResolution(null);
    void refreshResolution();
  }, [refreshResolution]);

  const selectTab = (next: Tab) => {
    setTab(next);
    const url = new URL(window.location.href);
    if (next === 'overview') url.searchParams.delete('tab');
    else url.searchParams.set('tab', next);
    window.history.replaceState(null, '', url);
  };

  const connectWallet = async () => {
    setGateError(null);
    const injected = connectors.find((c) => c.type === 'injected') ?? connectors[0];
    if (!injected) {
      setNoWallet(true);
      return;
    }
    setBusy('connecting');
    try {
      await connectAsync({ connector: injected });
    } catch (err) {
      const message = walletErrorMessage(err, {
        rejected: 'Connection was rejected in the wallet.',
        notFound: NO_WALLET,
        fallback: 'Couldn’t connect to your wallet.',
      });
      if (message === NO_WALLET) setNoWallet(true);
      else setGateError(message);
    } finally {
      setBusy(null);
    }
  };

  const signIn = async () => {
    if (!address) return;
    setGateError(null);
    setBusy('signing');
    try {
      const { nonce } = await api.getNonce(address);
      const signature = await signMessageAsync({ message: buildSignMessage(nonce) });
      const { token: newToken, wallet } = await api.verify(address, signature);
      saveAuth({ token: newToken, wallet });
    } catch (err) {
      setGateError(
        err instanceof ApiError
          ? err.message
          : walletErrorMessage(err, {
              rejected: 'Signature was rejected. Nothing was changed.',
              fallback: 'Sign-in failed.',
            }),
      );
    } finally {
      setBusy(null);
    }
  };

  const disconnectWallet = () => {
    disconnect();
    toast('Wallet disconnected');
  };

  const signOut = async () => {
    await api.signOut();
    disconnect();
    toast('Signed out');
  };

  if (!hydrated) return <DashboardSkeleton label="Loading…" />;
  if (status === 'connecting' || status === 'reconnecting') {
    return <DashboardSkeleton label="Restoring your session…" />;
  }

  const gateProps = {
    wallet: address,
    busy,
    error: gateError,
    noWallet,
    onConnect: () => void connectWallet(),
    onSign: () => void signIn(),
    onDisconnect: () => disconnect(),
  };

  if (status !== 'connected' || !address) return <GateCard kind="connect" {...gateProps} />;
  if (!auth) return <GateCard kind="sign" {...gateProps} />;
  if (!auth.username) {
    return meSettled ? <GateCard kind="no_name" {...gateProps} /> : <DashboardSkeleton label="Loading…" />;
  }

  const name = auth.username;
  const addresses = resolution?.addresses ?? {};
  const verified = resolution?.verified ?? {};
  const activeCount = CHAIN_ORDER.filter((c) => addresses[c]).length;
  const memberSince = me?.createdAt
    ? new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric' }).format(new Date(me.createdAt))
    : '—';

  return (
    <section className="mx-auto grid w-full max-w-content gap-5 px-6 pb-24 pt-12">
      <div className="flex animate-enter flex-wrap items-end justify-between gap-5">
        <div className="flex min-w-0 items-center gap-4">
          <span
            aria-hidden
            className="inline-flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-accent font-display text-[28px] font-bold text-on-accent"
          >
            {name.charAt(0)}
          </span>
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-ink2">Your paytag</div>
            <h1 className="mt-1 break-all font-display text-[clamp(32px,4.5vw,52px)] font-semibold leading-none tracking-display-lg">
              @{name}
            </h1>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            title={address}
            className="inline-flex min-h-10 items-center gap-2 whitespace-nowrap rounded-pill border border-line px-3.5 font-mono text-[13px] text-ink2"
          >
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-ok" />
            {shortAddress(address)}
          </span>
          <Button variant="outline-destructive" size={40} onClick={disconnectWallet}>
            Disconnect
          </Button>
        </div>
      </div>

      <div className="grid animate-enter grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3 [animation-delay:50ms]">
        <Stat value={resolution ? `${activeCount}/3` : '—'} label="Active networks" />
        <Stat value={String(activityCount)} label="Payments received" />
        <Stat value={memberSince} label="Member since" />
      </div>

      <SegmentedRail
        label="Dashboard sections"
        idPrefix="dash"
        value={tab}
        onChange={selectTab}
        items={TABS}
        className="animate-enter [animation-delay:80ms]"
      />

      <div
        key={tab}
        role="tabpanel"
        id={`dash-panel-${tab}`}
        aria-labelledby={`dash-tab-${tab}`}
        className="grid animate-enter gap-5"
      >
        {tab === 'overview' && (
          <>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(300px,100%),1fr))] gap-4">
              <ReceiveCard username={name} />
              <SetupCard username={name} addresses={addresses} loading={!resolution} />
            </div>
            <AddressManager
              addresses={addresses}
              verified={verified}
              loading={!resolution}
              onChanged={refreshResolution}
            />
            <Activity username={name} onCountChange={setActivityCount} />
          </>
        )}
        {tab === 'profile' && (
          <ProfileForm
            username={name}
            me={me}
            onSaved={(fields) => setMe((current) => (current ? { ...current, ...fields } : current))}
          />
        )}
        {tab === 'settings' && <Sessions wallet={address} onSignOut={signOut} />}
      </div>
    </section>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-inset-xl border border-line bg-surface px-5 py-[18px]">
      <div className="font-display text-[30px] font-semibold leading-none tracking-display-md">{value}</div>
      <div className="mt-1.5 text-[13px] text-ink2">{label}</div>
    </div>
  );
}

function DashboardSkeleton({ label }: { label: string }) {
  return (
    <section aria-busy="true" className="mx-auto grid w-full max-w-content gap-6 px-6 pb-24 pt-14">
      <SkeletonStatus>{label}</SkeletonStatus>
      <div className="flex items-center gap-4">
        <Skeleton shape="circle" className="h-16 w-16 shrink-0" />
        <div className="grid gap-2.5">
          <Skeleton className="h-[34px] w-[200px] max-w-[55vw]" />
          <Skeleton className="h-3.5 w-[120px]" delay={200} />
        </div>
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(280px,100%),1fr))] gap-4">
        <Skeleton shape="card" className="h-[260px]" delay={100} />
        <Skeleton shape="card" className="h-[260px]" delay={300} />
      </div>
    </section>
  );
}
