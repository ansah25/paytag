import type { ChainId as PaytagChain } from '@paytagdev/sdk';

interface ChainInfo {
  name: string;
  nativeSymbol: string;
  explorerTxUrl: (hash: string) => string;
  explorerAddressUrl: (addr: string) => string;
}

const CHAINS: Record<number, ChainInfo> = {
  1: {
    name: 'Ethereum',
    nativeSymbol: 'ETH',
    explorerTxUrl: (h) => `https://etherscan.io/tx/${h}`,
    explorerAddressUrl: (a) => `https://etherscan.io/address/${a}`,
  },
  11155111: {
    name: 'Sepolia',
    nativeSymbol: 'ETH',
    explorerTxUrl: (h) => `https://sepolia.etherscan.io/tx/${h}`,
    explorerAddressUrl: (a) => `https://sepolia.etherscan.io/address/${a}`,
  },
};

export const getChainInfo = (chainId: number | undefined): ChainInfo | null =>
  chainId ? CHAINS[chainId] ?? null : null;

export const isSupportedTxChain = (chainId: number | undefined): boolean =>
  chainId !== undefined && chainId in CHAINS;

// === Solana ===

export type SolanaNetwork = 'mainnet' | 'devnet';

export interface SolanaNetworkInfo {
  network: SolanaNetwork;
  label: string;
  /** Cluster name accepted by `clusterApiUrl(...)`. */
  cluster: 'mainnet-beta' | 'devnet';
  explorerTxUrl: (sig: string) => string;
}

export const SOLANA_NETWORKS: Record<SolanaNetwork, SolanaNetworkInfo> = {
  mainnet: {
    network: 'mainnet',
    label: 'Solana mainnet',
    cluster: 'mainnet-beta',
    explorerTxUrl: (s) => `https://solscan.io/tx/${s}`,
  },
  devnet: {
    network: 'devnet',
    label: 'Solana devnet',
    cluster: 'devnet',
    explorerTxUrl: (s) => `https://solscan.io/tx/${s}?cluster=devnet`,
  },
};

// === Bitcoin ===

export type BitcoinNetwork = 'mainnet' | 'testnet';

export interface BitcoinNetworkInfo {
  network: BitcoinNetwork;
  label: string;
  /** Sats Connect network type. */
  satsConnectType: 'Mainnet' | 'Testnet';
  explorerTxUrl: (txid: string) => string;
}

export const BITCOIN_NETWORKS: Record<BitcoinNetwork, BitcoinNetworkInfo> = {
  mainnet: {
    network: 'mainnet',
    label: 'Bitcoin mainnet',
    satsConnectType: 'Mainnet',
    explorerTxUrl: (t) => `https://mempool.space/tx/${t}`,
  },
  testnet: {
    network: 'testnet',
    label: 'Bitcoin testnet',
    satsConnectType: 'Testnet',
    explorerTxUrl: (t) => `https://mempool.space/testnet/tx/${t}`,
  },
};

// === Pretty labels for any paytag chain ===

export const CHAIN_LABELS: Record<PaytagChain, string> = {
  ethereum: 'Ethereum',
  solana: 'Solana',
  bitcoin: 'Bitcoin',
};

export const CHAIN_NATIVE_SYMBOL: Record<PaytagChain, string> = {
  ethereum: 'ETH',
  solana: 'SOL',
  bitcoin: 'BTC',
};

export type { PaytagChain };
