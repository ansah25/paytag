'use client';

import { useState } from 'react';
import { useSignMessage } from 'wagmi';
import { api, ApiError, buildSignMessage } from '@/lib/api';
import { saveAuth, AuthState } from '@/lib/auth';

interface Props {
  wallet: string;
  onSignedIn: (state: AuthState) => void;
}

export function SignInPanel({ wallet, onSignedIn }: Props) {
  const { signMessageAsync } = useSignMessage();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSignIn = async () => {
    setError(null);
    setBusy(true);
    try {
      const { nonce } = await api.getNonce(wallet);
      const signature = await signMessageAsync({ message: buildSignMessage(nonce) });
      const { token, wallet: normalized } = await api.verify(wallet, signature);
      // Persist the token before the /me call so api.me() can read it.
      const baseState: AuthState = { token, wallet: normalized };
      saveAuth(baseState);
      // The wallet is the source of truth for which paytag is "yours". Fetch
      // it server-side immediately so the UI never has a window where the
      // user could enter a different username than the one their wallet owns.
      let username: string | undefined;
      try {
        const me = await api.me();
        username = me.username ?? undefined;
      } catch {
        // /me failure shouldn't block sign-in — the dashboard will retry on
        // hydrate. Worst case the user sees the "register a name" path.
      }
      const state: AuthState = { ...baseState, username };
      saveAuth(state);
      onSignedIn(state);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-ink-2">
        Sign a message with your wallet to prove ownership. No transaction. No gas.
      </p>
      <button onClick={handleSignIn} disabled={busy} className="btn-primary">
        <span>{busy ? 'Waiting for signature…' : 'Sign in with wallet'}</span>
      </button>
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}
