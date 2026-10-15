import { http, createConfig } from 'wagmi';
import { baseSepolia, mainnet, sepolia } from 'wagmi/chains';
// Import from @wagmi/core, not the wagmi/connectors barrel: the barrel pulls in
// every connector (incl. Base Account -> @coinbase/cdp-sdk), whose optional
// x402 deps aren't installed and break the webpack build.
import { injected } from '@wagmi/core';

// Base Sepolia hosts the on-chain registry (/on-chain). Its public RPC is rate-limited;
// set NEXT_PUBLIC_BASE_SEPOLIA_RPC to a dedicated endpoint in production.
export const wagmiConfig = createConfig({
  chains: [mainnet, sepolia, baseSepolia],
  connectors: [injected({ shimDisconnect: true })],
  transports: {
    [mainnet.id]: http(),
    [sepolia.id]: http(),
    [baseSepolia.id]: http(process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC || undefined),
  },
  ssr: true,
});

declare module 'wagmi' {
  interface Register {
    config: typeof wagmiConfig;
  }
}
