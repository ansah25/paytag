import { http, createConfig } from 'wagmi';
import { baseSepolia, mainnet, sepolia } from 'wagmi/chains';
// Import from @wagmi/core, not the wagmi/connectors barrel: the barrel pulls in
// every connector (incl. Base Account -> @coinbase/cdp-sdk), whose optional
// x402 deps aren't installed and break the webpack build.
import { injected } from '@wagmi/core';

import { EVM_RPC } from './endpoints';

// Base Sepolia hosts the on-chain registry (/on-chain).
export const wagmiConfig = createConfig({
  chains: [mainnet, sepolia, baseSepolia],
  connectors: [injected({ shimDisconnect: true })],
  transports: {
    [mainnet.id]: http(EVM_RPC.mainnet),
    [sepolia.id]: http(EVM_RPC.sepolia),
    [baseSepolia.id]: http(EVM_RPC.baseSepolia),
  },
  ssr: true,
});

declare module 'wagmi' {
  interface Register {
    config: typeof wagmiConfig;
  }
}
