import { createPublicClient, fallback, http } from 'viem';
import { baseSepolia } from 'viem/chains';
import { env } from '../config/env';
import { CHAIN_ID } from './deployment';
import { BASE_SEPOLIA_PUBLIC_RPC } from './generated/endpoints';

// The one RPC client for chain reads. The public endpoint goes first (free, unmetered, but
// rate-limited and sometimes slow); a keyed provider, if configured, is the fallback. viem's
// fallback transport moves to the next endpoint when one errors or times out.

/** Per-call budget for one endpoint; the fallback gets its own. */
export const RPC_TIMEOUT_MS = 2_500;

if (baseSepolia.id !== CHAIN_ID) throw new Error('src/onchain/deployment.ts is not on Base Sepolia');

const endpoints = [BASE_SEPOLIA_PUBLIC_RPC, env.BASE_SEPOLIA_RPC_FALLBACK_URL].filter(
  (url): url is string => typeof url === 'string',
);

const makeClient = (urls: readonly string[]) =>
  createPublicClient({
    chain: baseSepolia,
    // No retries anywhere: fallback() would otherwise retry the whole list 3 times (about 20s
    // per failed read, and 4 calls on the metered fallback). One pass over the endpoints.
    transport: fallback(
      urls.map((url) => http(url, { timeout: RPC_TIMEOUT_MS, retryCount: 0 })),
      { retryCount: 0 },
    ),
  });

export type ChainClient = ReturnType<typeof makeClient>;

let client: ChainClient = makeClient(endpoints);

export const chainClient = (): ChainClient => client;

/** Tests only: point the client at other endpoints (a local mock RPC). */
export const setChainClientForTests = (urls: readonly string[] | null): void => {
  client = makeClient(urls ?? endpoints);
};
