import type { Hash } from 'viem';
import type { TxError } from './errors';

// Lifecycle of one on-chain write. Pure, so every transition is unit-tested.
//
//   idle ─start─▶ simulating ─simulated─▶ signing ─submitted─▶ pending ─mined─▶ confirmed ─indexed─▶ indexed
//                     │                      │                    │                │
//                     └──────────────────────┴────────fail────────┴────────────────┴──▶ failed
//
// "confirmed" means the receipt succeeded; "indexed" means the indexer has caught up to that
// block, so reads reflect the write. Any state can `reset` back to idle.

export type TxStage = 'simulating' | 'signing' | 'pending' | 'confirmed';

export type TxState =
  | { status: 'idle' }
  | { status: 'simulating' }
  | { status: 'signing' }
  | { status: 'pending'; hash: Hash }
  | { status: 'confirmed'; hash: Hash; blockNumber: bigint }
  | { status: 'indexed'; hash: Hash; blockNumber: bigint }
  | { status: 'failed'; error: TxError; stage: TxStage; hash?: Hash };

export type TxAction =
  | { type: 'start' }
  | { type: 'simulated' }
  | { type: 'submitted'; hash: Hash }
  | { type: 'mined'; blockNumber: bigint }
  | { type: 'indexed' }
  | { type: 'fail'; error: TxError }
  | { type: 'reset' };

export const IDLE: TxState = { status: 'idle' };

export function txReducer(state: TxState, action: TxAction): TxState {
  switch (action.type) {
    case 'reset':
      return IDLE;
    case 'start':
      // A new attempt may start from rest or after a failure, never mid-flight.
      return state.status === 'idle' || state.status === 'failed' || state.status === 'indexed'
        ? { status: 'simulating' }
        : state;
    case 'simulated':
      return state.status === 'simulating' ? { status: 'signing' } : state;
    case 'submitted':
      return state.status === 'signing' ? { status: 'pending', hash: action.hash } : state;
    case 'mined':
      return state.status === 'pending'
        ? { status: 'confirmed', hash: state.hash, blockNumber: action.blockNumber }
        : state;
    case 'indexed':
      return state.status === 'confirmed' ? { status: 'indexed', hash: state.hash, blockNumber: state.blockNumber } : state;
    case 'fail':
      switch (state.status) {
        case 'simulating':
        case 'signing':
          return { status: 'failed', error: action.error, stage: state.status };
        case 'pending':
        case 'confirmed':
          return { status: 'failed', error: action.error, stage: state.status, hash: state.hash };
        default:
          return state;
      }
  }
}

/** True while a write is in flight: buttons stay disabled and the form is locked. */
export const isBusy = (s: TxState) => s.status === 'simulating' || s.status === 'signing' || s.status === 'pending';
