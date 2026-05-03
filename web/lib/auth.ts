const STORAGE_KEY = 'paytag_auth_v1';

export interface AuthState {
  token: string;
  wallet: string;
  username?: string;
}

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
};

export const updateAuth = (patch: Partial<AuthState>): void => {
  const current = getAuth();
  if (!current) return;
  saveAuth({ ...current, ...patch });
};

export const clearAuth = (): void => {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(STORAGE_KEY);
};

export const getToken = (): string | null => getAuth()?.token ?? null;
