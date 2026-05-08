const STORAGE_KEY = 'paytag_auth_v1';
const AUTH_EVENT = 'paytag:auth-change';

export interface AuthState {
  token: string;
  wallet: string;
  username?: string;
}

const dispatchChange = (): void => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(AUTH_EVENT));
};

export const getAuth = (): AuthState | null => {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthState;
  } catch {
    return null;
  }
};

export const saveAuth = (state: AuthState): void => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  dispatchChange();
};

export const updateAuth = (patch: Partial<AuthState>): void => {
  const current = getAuth();
  if (!current) return;
  saveAuth({ ...current, ...patch });
};

// Sync the locally-cached username with what the server says this wallet owns.
// The server is the only authority — if /me returns null but localStorage has
// a username, the cache is stale (e.g. another device, deleted account, or a
// pre-fix client that wrote whatever it wanted) and must be cleared.
export const syncAuthWithServer = (server: { wallet: string; username: string | null }): void => {
  const current = getAuth();
  if (!current) return;
  if (current.wallet.toLowerCase() !== server.wallet.toLowerCase()) {
    // Token belongs to a different wallet than the one /me reported — should
    // not happen, but treat as a forced sign-out rather than silently mixing.
    clearAuth();
    return;
  }
  const next: AuthState = {
    ...current,
    username: server.username ?? undefined,
  };
  if (next.username === current.username) return;
  saveAuth(next);
};

export const clearAuth = (): void => {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(STORAGE_KEY);
  dispatchChange();
};

export const getToken = (): string | null => getAuth()?.token ?? null;

export const subscribeAuth = (cb: () => void): (() => void) => {
  if (typeof window === 'undefined') return () => {};
  const handler = (e: Event) => {
    if (e.type === 'storage' && (e as StorageEvent).key !== STORAGE_KEY) return;
    cb();
  };
  window.addEventListener('storage', handler);
  window.addEventListener(AUTH_EVENT, handler);
  return () => {
    window.removeEventListener('storage', handler);
    window.removeEventListener(AUTH_EVENT, handler);
  };
};
