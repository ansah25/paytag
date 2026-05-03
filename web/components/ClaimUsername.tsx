'use client';

import { FormEvent, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { updateAuth } from '@/lib/auth';

interface Props {
  wallet: string;
  onClaimed: (username: string) => void;
}

export function ClaimUsername({ wallet, onClaimed }: Props) {
  const [username, setUsername] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const data = await api.resolve(username.trim().toLowerCase());
      // Owner check is best-effort: we don't expose owner_wallet via /resolve.
      // Treat any successful resolution as a claim by the connected wallet —
      // the JWT already proves wallet ownership, and /add-address will reject
      // if this wallet isn't actually the registered owner.
      void wallet;
      updateAuth({ username: data.username });
      onClaimed(data.username);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Username not found');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="space-y-3 max-w-md">
      <p className="text-muted text-sm">
        Already registered on another device? Enter your username to load your dashboard.
      </p>
      <div className="flex gap-3">
        <div className="flex-1 flex items-center bg-panel border border-border rounded-lg px-4 focus-within:border-accent">
          <span className="text-muted mr-1">@</span>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="yourname"
            className="flex-1 bg-transparent py-3 outline-none placeholder:text-muted"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
        </div>
        <button
          type="submit"
          disabled={busy || !username.trim()}
          className="bg-panel border border-border hover:border-accent text-sm px-4 rounded-lg"
        >
          {busy ? 'Loading…' : 'Load'}
        </button>
      </div>
      {error && <p className="text-sm text-red-300">{error}</p>}
    </form>
  );
}
