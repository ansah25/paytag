import { Paytag, PaytagError } from '@paytagdev/sdk';
import type {
  ChainId,
  ResolveResponse as SdkResolveResponse,
  AvailabilityResponse as SdkAvailabilityResponse,
} from '@paytagdev/sdk';
import { clearAuth, getToken } from './auth';
import { describeDevice } from './device';

const BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000';

// The API marks /resolve cacheable (max-age=30, stale-while-revalidate=60) for
// third-party SDK users. This app shows data the user may have just changed,
// so in the browser ask for revalidation every time — an unchanged response is
// still a cheap 304 thanks to its ETag.
type SdkFetch = NonNullable<NonNullable<ConstructorParameters<typeof Paytag>[0]>['fetch']>;
const revalidatingFetch: SdkFetch = (input, init) =>
  typeof window === 'undefined' ? fetch(input, init) : fetch(input, { ...init, cache: 'no-cache' });

// Single SDK client shared across the web app. Its in-memory cache (30 s TTL)
// makes repeated resolves free; mutations below invalidate it.
const sdk = new Paytag({ baseUrl: BASE_URL, fetch: revalidatingFetch });

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
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
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
export interface ProfileFields {
  displayName: string | null;
  bio: string | null;
  avatarUrl: string | null;
}
export interface MeResponse extends Partial<ProfileFields> {
  wallet: string;
  username: string | null;
  createdAt: string | null;
}
/** Resolve plus the fields added with profiles and address verification. */
export type ResolveResponse = SdkResolveResponse &
  Partial<ProfileFields> & {
    /** Chains whose mapped address was proven with a signature. */
    verified?: Partial<Record<ChainId, boolean>>;
  };
export type AvailabilityResponse = SdkAvailabilityResponse;

/**
 * Address mutations return the owner's updated resolution. Use it instead of
 * re-reading /resolve, which can briefly return a cached copy after a write.
 * Optional so an older API still works (callers fall back to a re-fetch).
 */
interface WithResolution {
  resolution?: ResolveResponse;
}
export interface AddAddressResponse extends WithResolution {
  chain: string;
  address: string;
}
export interface RemoveAddressResponse extends WithResolution {
  chain: ChainId;
  removed: true;
}
export interface VerifyAddressResponse extends WithResolution {
  chain: ChainId;
  verified: true;
  verifiedAt: string;
}

export interface VerificationChallenge {
  chain: ChainId;
  address: string;
  message: string;
}

export interface ActivityItem {
  chain: ChainId;
  from: string;
  amount: string;
  when: string;
  network: string;
  status: string;
}

export interface SessionInfo {
  id: string;
  device: string;
  meta: string;
  current: boolean;
}

// Single-flight `/me`: useAuthState (in SiteHeader) and the dashboard at /app
// both call /me on hydrate. Without this, every dashboard load fires two
// identical requests in parallel. We coalesce them into one in-flight promise
// that any caller can await; the slot clears as soon as the request settles.
//
// AbortSignal handling: each caller can pass a signal, but aborting one
// caller's signal must NOT cancel the underlying request — other callers are
// still awaiting the same promise. We ignore per-caller signals here (the
// /me payload is tiny and short-lived; nothing useful to abort).
let mePending: Promise<MeResponse> | null = null;
const meSingleFlight = (_signal?: AbortSignal): Promise<MeResponse> => {
  if (mePending) return mePending;
  mePending = request<MeResponse>('/me', { auth: true }).finally(() => {
    mePending = null;
  });
  return mePending;
};

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
  me: (signal?: AbortSignal) => meSingleFlight(signal),
  addAddress: async (chain: string, address: string) => {
    try {
      return await request<AddAddressResponse>('/add-address', {
        method: 'POST',
        body: { chain, address },
        auth: true,
      });
    } finally {
      // Drop the SDK cache whether or not the write landed, so the next
      // resolve re-reads rather than serving a copy from before the attempt.
      sdk.invalidate();
    }
  },
  removeAddress: async (chain: ChainId) => {
    try {
      return await request<RemoveAddressResponse>(`/address/${encodeURIComponent(chain)}`, {
        method: 'DELETE',
        auth: true,
      });
    } finally {
      sdk.invalidate();
    }
  },
  /** Ask the server for a one-time message proving control of the mapped address. */
  verifyAddressChallenge: (chain: ChainId) =>
    request<VerificationChallenge>('/verify-address/nonce', {
      method: 'POST',
      body: { chain },
      auth: true,
    }),
  verifyAddress: async (chain: ChainId, signature: string) => {
    try {
      return await request<VerifyAddressResponse>('/verify-address', {
        method: 'POST',
        body: { chain, signature },
        auth: true,
      });
    } finally {
      sdk.invalidate();
    }
  },
  updateProfile: async (fields: { displayName: string | null; bio: string | null }) => {
    const result = await request<ProfileFields & { username: string }>('/me/profile', {
      method: 'PATCH',
      body: fields,
      auth: true,
    });
    sdk.invalidate();
    return result;
  },
  // Stub: needs a storage bucket. The UI validates the file and shows this message.
  uploadAvatar: async (_file: File): Promise<{ avatarUrl: string }> => {
    throw new ApiError(501, 'NOT_IMPLEMENTED', 'Photo uploads are coming soon.');
  },
  // Stub: there is no payment indexer yet, so history is always empty.
  activity: async (_username: string): Promise<ActivityItem[]> => [],
  // Stub: JWTs are stateless, so only the current browser session is known.
  sessions: async (): Promise<SessionInfo[]> => [
    {
      id: 'this-device',
      device: describeDevice(typeof navigator === 'undefined' ? '' : navigator.userAgent),
      meta: 'Active now',
      current: true,
    },
  ],
  /** Clears this browser's session. Tokens on other devices expire on their own. */
  signOut: async () => {
    clearAuth();
  },
  resolve: (username: string, signal?: AbortSignal): Promise<ResolveResponse> =>
    sdk.resolve(username, { signal }).catch(wrapPaytagError),
  available: (username: string, signal?: AbortSignal): Promise<AvailabilityResponse> =>
    sdk.available(username, { signal }).catch(wrapPaytagError),
};

export const buildSignMessage = (nonce: string): string =>
  `Paytag authentication\n\nSign this message to log in.\n\nNonce: ${nonce}`;
