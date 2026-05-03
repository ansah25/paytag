'use client';

import { useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import { ConnectWallet, DisconnectButton } from '@/components/ConnectWallet';
import { SignInPanel } from '@/components/SignInPanel';
import { RegisterForm } from '@/components/RegisterForm';
import { AddressManager } from '@/components/AddressManager';
import { ClaimUsername } from '@/components/ClaimUsername';
import { AuthState, clearAuth, getAuth } from '@/lib/auth';

const shortAddr = (addr: string) => `${addr.slice(0, 6)}…${addr.slice(-4)}`;

export default function AppPage() {
  const { address, isConnected } = useAccount();
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setAuth(getAuth());
    setHydrated(true);
  }, []);

  // If wallet disconnects or changes to a different address, clear auth
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

  if (!hydrated) {
    return <div className="text-muted">Loading…</div>;
  }

  return (
    <div className="space-y-8">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Manage your paytag</h1>
        {isConnected && address && (
          <div className="flex items-center gap-3 text-sm">
            <span className="text-muted">Connected</span>
            <span className="font-mono">{shortAddr(address)}</span>
            <DisconnectButton />
          </div>
        )}
      </header>

      {!isConnected || !address ? (
        <Card title="Connect your wallet">
          <ConnectWallet />
        </Card>
      ) : !auth ? (
        <Card title="Sign in">
          <SignInPanel wallet={address} onSignedIn={setAuth} />
        </Card>
      ) : !auth.username ? (
        <div className="space-y-6">
          <Card title="Register a username">
            <RegisterForm
              onRegistered={(username) => setAuth({ ...auth, username })}
            />
          </Card>
          <Card title="Already have one?">
            <ClaimUsername
              wallet={address}
              onClaimed={(username) => setAuth({ ...auth, username })}
            />
          </Card>
        </div>
      ) : (
        <Card title={`@${auth.username}`}>
          <AddressManager username={auth.username} />
        </Card>
      )}
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-panel border border-border rounded-xl p-6 space-y-4">
      <h2 className="text-base text-muted font-medium">{title}</h2>
      {children}
    </section>
  );
}
