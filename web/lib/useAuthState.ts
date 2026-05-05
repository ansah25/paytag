'use client';

import { useEffect, useState } from 'react';
import { AuthState, getAuth, subscribeAuth } from './auth';

export interface AuthSnapshot {
  auth: AuthState | null;
  hydrated: boolean;
  isSignedIn: boolean;
  hasUsername: boolean;
}

export function useAuthState(): AuthSnapshot {
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setAuth(getAuth());
    setHydrated(true);
    return subscribeAuth(() => setAuth(getAuth()));
  }, []);

  return {
    auth,
    hydrated,
    isSignedIn: !!auth?.token,
    hasUsername: !!auth?.username,
  };
}
