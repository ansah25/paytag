import { Paytag, PaytagError } from '@paytagdev/sdk';
import type {
  ResolveResponse as SdkResolveResponse,
  AvailabilityResponse as SdkAvailabilityResponse,
} from '@paytagdev/sdk';
import { clearAuth, getToken } from './auth';

const BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000';

// Single SDK client shared across the web app. Cache is enabled (30 s TTL) so
// repeated resolves of the same username are free; we explicitly invalidate
// after mutations (see `addAddress`).
const sdk = new Paytag({ baseUrl: BASE_URL });

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const wrapPaytagError = (err: unknown): never => {
  if (err instanceof PaytagError) {
    const status =
      err.status ??
      (err.code === 'USER_NOT_FOUND'
        ? 404
        : err.code === 'INVALID_USERNAME'
          ? 400
          : err.code === 'NETWORK_ERROR'
            ? 0
            : 500);
    throw new ApiError(status, err.code, err.message);
  }
  throw err;
};

interface RequestOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  auth?: boolean;
  signal?: AbortSignal;
}

const request = async <T>(path: string, opts: RequestOptions = {}): Promise<T> => {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.auth) {
    const token = getToken();
    if (!token) throw new ApiError(401, 'TOKEN_MISSING', 'Not signed in');
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
  });

  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }

  if (!res.ok) {
    if (res.status === 401 && opts.auth) clearAuth();
    const obj = (payload && typeof payload === 'object' ? payload : {}) as {
      error?: string;
      code?: string;
    };
    throw new ApiError(
      res.status,
      obj.code ?? 'UNKNOWN_ERROR',
      obj.error ?? `Request failed with status ${res.status}`,
    );
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
export type ResolveResponse = SdkResolveResponse;
export type AvailabilityResponse = SdkAvailabilityResponse;

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
  addAddress: async (chain: string, address: string) => {
    const result = await request<AddAddressResponse>('/add-address', {
      method: 'POST',
      body: { chain, address },
      auth: true,
    });
    // The user just mutated their own mapping — drop the SDK cache so the next
    // resolve returns fresh data.
    sdk.invalidate();
    return result;
  },
  resolve: (username: string, signal?: AbortSignal): Promise<ResolveResponse> =>
    sdk.resolve(username, { signal }).catch(wrapPaytagError),
  available: (username: string, signal?: AbortSignal): Promise<AvailabilityResponse> =>
    sdk.available(username, { signal }).catch(wrapPaytagError),
};

export const buildSignMessage = (nonce: string): string =>
  `Paytag authentication\n\nSign this message to log in.\n\nNonce: ${nonce}`;
