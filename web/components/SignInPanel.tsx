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
      const state: AuthState = { token, wallet: normalized };
      saveAuth(state);
      onSignedIn(state);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-muted text-sm">
        Sign a message with your wallet to prove ownership. No transaction, no gas.
      </p>
      <button
        onClick={handleSignIn}
        disabled={busy}
        className="bg-accent hover:opacity-90 disabled:opacity-40 text-white font-medium px-6 py-3 rounded-lg"
      >
        {busy ? 'Waiting for signature…' : 'Sign in with wallet'}
      </button>
      {error && <p className="text-sm text-red-300">{error}</p>}
    </div>
  );
}
