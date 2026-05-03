'use client';

import { FormEvent, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { updateAuth } from '@/lib/auth';

interface Props {
  onRegistered: (username: string) => void;
}

export function RegisterForm({ onRegistered }: Props) {
  const [username, setUsername] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await api.register(username.trim().toLowerCase());
      updateAuth({ username: result.username });
      onRegistered(result.username);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Registration failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="space-y-3 max-w-md">
      <p className="text-muted text-sm">
        Pick a username (3–20 chars, lowercase letters, numbers, or underscore).
      </p>
      <div className="flex items-center bg-panel border border-border rounded-lg px-4 focus-within:border-accent">
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
        className="bg-accent hover:opacity-90 disabled:opacity-40 text-white font-medium px-6 py-3 rounded-lg"
      >
        {busy ? 'Registering…' : 'Register username'}
      </button>
      {error && <p className="text-sm text-red-300">{error}</p>}
    </form>
  );
}
