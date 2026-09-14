import { http, createConfig } from 'wagmi';
import { mainnet, sepolia } from 'wagmi/chains';
// Import from @wagmi/core, not the wagmi/connectors barrel: the barrel pulls in
// every connector (incl. Base Account -> @coinbase/cdp-sdk), whose optional
// x402 deps aren't installed and break the webpack build.
import { injected } from '@wagmi/core';

export const wagmiConfig = createConfig({
  chains: [mainnet, sepolia],
  connectors: [injected({ shimDisconnect: true })],
  transports: {
    [mainnet.id]: http(),
    [sepolia.id]: http(),
  },
  ssr: true,
});

declare module 'wagmi' {
  interface Register {
    config: typeof wagmiConfig;
  }
}
