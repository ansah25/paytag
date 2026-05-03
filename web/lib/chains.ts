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
