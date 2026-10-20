import endpoints from './endpoints.json';

// Every origin the browser talks to, in one place. The Content-Security-Policy's connect-src is
// built from the same JSON (web/security-headers.js), so an endpoint added here is allowed there.
// Fetch a new origin from anywhere else and the CSP will block it.

const trimSlash = (url: string) => url.replace(/\/+$/, '');

export const API_URL = trimSlash(process.env.NEXT_PUBLIC_API_BASE_URL || endpoints.apiDefault);
export const INDEXER_URL = trimSlash(process.env.NEXT_PUBLIC_INDEXER_URL || endpoints.indexerDefault);

/** Our own RPC choice, not viem's defaults: a viem upgrade must not silently move them off the CSP. */
export const EVM_RPC = {
  mainnet: endpoints.evmRpc.mainnet,
  sepolia: endpoints.evmRpc.sepolia,
  // The public endpoint is rate-limited; production sets a dedicated one.
  baseSepolia: process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC || endpoints.evmRpc.baseSepolia,
};

/** @solana/web3.js also opens a websocket on the same host (wss://) to confirm transactions. */
export const SOLANA_RPC = endpoints.solanaRpc;

export const MEMPOOL_API = endpoints.mempoolApi;

export const PRICES_URL = endpoints.pricesUrl;
