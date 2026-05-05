import { Paytag, AvailableOptions, ResolveOptions } from './client';
import {
  AvailabilityResponse,
  ChainId,
  ResolveResponse,
} from './types';

export { Paytag } from './client';
export type {
  PaytagOptions,
  ResolveOptions,
  AvailableOptions,
  FetchLike,
} from './client';
export { PaytagError } from './errors';
export type { PaytagErrorCode } from './errors';
export { SUPPORTED_CHAINS, DEFAULT_BASE_URL } from './types';
export type {
  ChainId,
  ResolveResponse,
  AvailabilityResponse,
  UnavailableReason,
} from './types';
export { MemoryCache } from './cache';
export type { Cache } from './cache';

// Default singleton — instantiated lazily so importing the package never
// throws when no fetch is available; the error only surfaces when used.
let defaultClient: Paytag | undefined;
const getDefaultClient = (): Paytag => {
  if (!defaultClient) defaultClient = new Paytag();
  return defaultClient;
};

/** Reset the singleton client. Mainly useful in tests. */
export const __resetDefaultClient = (): void => {
  defaultClient = undefined;
};

/** Resolve a username via the default `https://api.paytag.dev` client. */
export const resolve = (
  username: string,
  opts?: ResolveOptions,
): Promise<ResolveResponse> => getDefaultClient().resolve(username, opts);

/** Resolve a single chain's address via the default client. */
export const resolveAddress = (
  username: string,
  chain: ChainId,
  opts?: ResolveOptions,
): Promise<string | null> =>
  getDefaultClient().resolveAddress(username, chain, opts);

/** Check username availability via the default client. */
export const available = (
  username: string,
  opts?: AvailableOptions,
): Promise<AvailabilityResponse> => getDefaultClient().available(username, opts);
