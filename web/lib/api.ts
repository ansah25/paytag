import { clearAuth, getToken } from './auth';

const BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  auth?: boolean;
}

const request = async <T>(path: string, opts: RequestOptions = {}): Promise<T> => {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.auth) {
    const token = getToken();
    if (!token) throw new ApiError(401, 'Not signed in');
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }

  if (!res.ok) {
    if (res.status === 401 && opts.auth) clearAuth();
    const msg =
      (payload && typeof payload === 'object' && 'error' in payload
        ? String((payload as { error: unknown }).error)
        : null) ?? `Request failed with status ${res.status}`;
    throw new ApiError(res.status, msg);
  }

  return payload as T;
};

export interface NonceResponse {
  nonce: string;
}
export interface VerifyResponse {
  token: string;
  wallet: string;
}
export interface RegisterResponse {
  id: string;
  username: string;
  ownerWallet: string;
  createdAt: string;
}
export interface AddAddressResponse {
  chain: string;
  address: string;
}
export interface ResolveResponse {
  username: string;
  addresses: Partial<Record<'ethereum' | 'solana' | 'bitcoin', string>>;
}

export const api = {
  getNonce: (wallet: string) =>
    request<NonceResponse>(`/auth/nonce?wallet=${encodeURIComponent(wallet)}`),
  verify: (wallet: string, signature: string) =>
    request<VerifyResponse>('/auth/verify', {
      method: 'POST',
      body: { wallet, signature },
    }),
  register: (username: string) =>
    request<RegisterResponse>('/register', {
      method: 'POST',
      body: { username },
      auth: true,
    }),
  addAddress: (chain: string, address: string) =>
    request<AddAddressResponse>('/add-address', {
      method: 'POST',
      body: { chain, address },
      auth: true,
    }),
  resolve: (username: string) =>
    request<ResolveResponse>(`/resolve/${encodeURIComponent(username)}`),
};

export const buildSignMessage = (nonce: string): string =>
  `Paytag authentication\n\nSign this message to log in.\n\nNonce: ${nonce}`;
