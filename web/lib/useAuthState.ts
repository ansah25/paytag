'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from './api';
import { AuthState, clearAuth, getAuth, subscribeAuth, syncAuthWithServer } from './auth';

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
    const initial = getAuth();
    setAuth(initial);
    setHydrated(true);
    const unsubscribe = subscribeAuth(() => setAuth(getAuth()));

    // After hydrating, ask the server which paytag this wallet actually owns.
    // localStorage is just a cache; the server is authoritative. This fixes
    // stale entries left by older clients that let users type any name.
    if (initial?.token) {
      const controller = new AbortController();
      api
        .me(controller.signal)
        .then((me) => syncAuthWithServer(me))
        .catch((err) => {
          // 401 = token expired/invalid; api.ts already cleared it. For other
          // errors leave the cached state alone so we don't sign the user out
          // over a transient network blip.
          if (err instanceof ApiError && err.status === 401) {
            clearAuth();
          }
        });
      return () => {
        controller.abort();
        unsubscribe();
      };
    }
    return unsubscribe;
  }, []);

  return {
    auth,
    hydrated,
    isSignedIn: !!auth?.token,
    hasUsername: !!auth?.username,
  };
}
