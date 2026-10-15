import type { PaytagChain } from '@/lib/chains';
import { COIN_TYPE } from './generated/codec';

/** The record slots the app edits, in display order (ENSIP-9 / ENSIP-11 coin types). */
export interface RecordSlot {
  coinType: bigint;
  label: string;
  /** For the colour dot; Base has none of its own. */
  chain: PaytagChain | null;
  placeholder: string;
}

export const BASE_COIN_TYPE = 0x80000000n | 8453n;

export const RECORD_SLOTS: RecordSlot[] = [
  { coinType: COIN_TYPE.ETH, label: 'Ethereum', chain: 'ethereum', placeholder: '0x…' },
  { coinType: BASE_COIN_TYPE, label: 'Base', chain: null, placeholder: '0x…' },
  { coinType: COIN_TYPE.SOL, label: 'Solana', chain: 'solana', placeholder: 'Solana address' },
  { coinType: COIN_TYPE.BTC, label: 'Bitcoin', chain: 'bitcoin', placeholder: 'bc1… / 1… / 3…' },
];

export const EXPLORER = 'https://sepolia.basescan.org';
export const txUrl = (hash: string) => `${EXPLORER}/tx/${hash}`;
export const addressUrl = (address: string) => `${EXPLORER}/address/${address}`;
