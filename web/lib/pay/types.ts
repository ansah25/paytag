import type { PaytagChain } from '@/lib/chains';

export type WalletStatus = 'detecting' | 'not_installed' | 'disconnected' | 'connecting' | 'connected';

export interface PayNetwork {
  id: string;
  /** Short label for the toggle: "Mainnet", "Sepolia". */
  label: string;
}

export interface FeeEstimate {
  /** Fee in the chain's native unit, used for the fiat conversion. */
  native: number;
  /** "~0.00041 ETH", "~1,680 sats". */
  display: string;
  /** Shown after the fiat value, e.g. "12 sat/vB". */
  detail?: string;
}

/**
 * Common interface over the three chain integrations. PayFlow owns the UI and
 * state machine; an adapter only knows how to talk to its wallet and chain.
 */
export interface PayAdapter {
  status: WalletStatus;
  connectError: string | null;
  connect: () => Promise<void>;
  /** Re-run wallet detection ("Check again" after not_installed). */
  recheck?: () => void;
  wallet: string | null;
  /** Wallet brand for "Connected via Phantom", when known. */
  walletVia: string | null;

  networks: PayNetwork[];
  network: string;
  setNetwork: (id: string) => void;
  switchingNetwork: boolean;
  networkError: string | null;
  /** EVM only: the wallet is on a chain Paytag can't send on. */
  unsupportedNetwork: boolean;
  /** Long label: "Ethereum mainnet", "Sepolia", "Solana devnet". */
  networkLabel: string;
  isTestnet: boolean;

  /** Recipient fails this chain's address check — nothing can be sent. */
  recipientError: string | null;
  isSelf: boolean;

  /** Returns an error message, or null when the amount can be sent. */
  validateAmount: (amount: string) => string | null;
  estimateFee: (amount: string) => Promise<FeeEstimate>;
  send: (amount: string) => Promise<{ hash: string }>;
  /** Omitted for chains without a practical confirmation wait (Bitcoin). */
  waitForConfirmation?: (hash: string) => Promise<void>;
  explorerUrl: (hash: string) => string;
}

/** Props the PayPanel shell passes to each lazily loaded chain flow. */
export interface PayFlowProps {
  username: string;
  recipient: string;
  verified: boolean;
  /** Another chain in this panel whose wallet is already connected. */
  otherWallet: { chain: PaytagChain } | null;
  onSwitchChain: (chain: PaytagChain) => void;
  /** Lets the shell lock the chain tabs while a transaction is in flight. */
  onBusyChange: (busy: boolean) => void;
}
