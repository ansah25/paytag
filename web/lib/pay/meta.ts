import type { PaytagChain } from '@/lib/chains';

export interface ChainMeta {
  label: string;
  symbol: string;
  quickAmounts: string[];
  /** "Connect {walletName}", "Confirm in {walletName}…". */
  walletName: string;
  connectCopy: string;
  explorerLabel: string;
  successKicker: string;
  successNote: (networkLabel: string) => string;
}

export const CHAIN_ORDER: PaytagChain[] = ['ethereum', 'solana', 'bitcoin'];

export const CHAIN_META: Record<PaytagChain, ChainMeta> = {
  ethereum: {
    label: 'Ethereum',
    symbol: 'ETH',
    quickAmounts: ['0.005', '0.01', '0.05', '0.1'],
    walletName: 'wallet',
    connectCopy:
      'Connect an Ethereum wallet to send. The transaction is signed in your wallet; Paytag never holds funds.',
    explorerLabel: 'View on Etherscan',
    successKicker: 'Sent · confirmed',
    successNote: (network) => `Confirmed on ${network}`,
  },
  solana: {
    label: 'Solana',
    symbol: 'SOL',
    quickAmounts: ['0.1', '0.5', '1', '5'],
    walletName: 'Phantom',
    connectCopy: 'Connect Phantom to send SOL. You approve the transfer in the extension.',
    explorerLabel: 'View on Solscan',
    successKicker: 'Sent · confirmed',
    successNote: (network) => `Confirmed on ${network}`,
  },
  bitcoin: {
    label: 'Bitcoin',
    symbol: 'BTC',
    quickAmounts: ['0.0001', '0.001', '0.01', '0.1'],
    walletName: 'Bitcoin wallet',
    connectCopy:
      'Connect Xverse or Leather to send BTC. The network toggle only changes the explorer link — your wallet decides where it broadcasts.',
    explorerLabel: 'Track on mempool.space',
    successKicker: 'Broadcast',
    successNote: () => 'Confirmations take about 10 minutes per block',
  },
};
