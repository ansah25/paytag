'use client';

import { useCallback, useReducer, useRef } from 'react';
import type { Address, Hash, Hex, SimulateContractParameters } from 'viem';
import { usePublicClient, useSwitchChain, useWriteContract } from 'wagmi';
import { baseSepolia } from 'wagmi/chains';
import { PaytagRegistryAbi } from './generated/PaytagRegistryAbi';
import { PaytagResolverAbi } from './generated/PaytagResolverAbi';
import { REGISTRY_ADDRESS, RESOLVER_ADDRESS } from './generated/deployment';
import { decodeTxError, type ErrorContext, type TxError } from './errors';
import { waitForIndexer } from './indexer';
import { IDLE, isBusy, txReducer, type TxState } from './txMachine';
import { useHydratedAccount } from './useHydratedAccount';

export const ONCHAIN_CHAIN = baseSepolia;

/** The four writes the app makes. Built into contract calls by `buildWrite`. */
export type OnchainWrite =
  | { kind: 'register'; name: string }
  | { kind: 'setRecord'; node: Hex; coinType: bigint; value: Hex }
  | { kind: 'transfer'; node: Hex; to: Address }
  | { kind: 'setReverse'; node: Hex };

export function buildWrite(write: OnchainWrite) {
  switch (write.kind) {
    case 'register':
      return { address: REGISTRY_ADDRESS as Address, abi: PaytagRegistryAbi, functionName: 'register', args: [write.name] } as const;
    case 'transfer':
      return { address: REGISTRY_ADDRESS as Address, abi: PaytagRegistryAbi, functionName: 'transfer', args: [write.node, write.to] } as const;
    case 'setRecord':
      return {
        address: RESOLVER_ADDRESS as Address,
        abi: PaytagResolverAbi,
        functionName: 'setRecord',
        args: [write.node, write.coinType, write.value],
      } as const;
    case 'setReverse':
      return { address: RESOLVER_ADDRESS as Address, abi: PaytagResolverAbi, functionName: 'setReverse', args: [write.node] } as const;
  }
}

export interface RunCallbacks {
  context?: ErrorContext;
  /** Signed and broadcast: apply the optimistic UI change here. */
  onSubmitted?: (hash: Hash) => void;
  /** Receipt succeeded. */
  onConfirmed?: (hash: Hash, blockNumber: bigint) => void;
  /** Indexer caught up (or timed out: `caughtUp` false). Refetch reads here. */
  onIndexed?: (caughtUp: boolean) => void;
  /** Any failure: roll back the optimistic change here. */
  onFailed?: (error: TxError) => void;
}

/**
 * Runs one on-chain write through simulate → sign → receipt → indexer, exposing each step as
 * explicit state. Simulation runs first so most reverts surface as a readable reason before the
 * wallet opens.
 */
export function useOnchainTx() {
  const [state, dispatch] = useReducer(txReducer, IDLE);
  const { address, chainId, status } = useHydratedAccount();
  const publicClient = usePublicClient({ chainId: ONCHAIN_CHAIN.id });
  const { writeContractAsync } = useWriteContract();
  const { switchChainAsync, isPending: switching } = useSwitchChain();
  const inFlight = useRef(false);

  const connected = status === 'connected' && !!address;
  const wrongNetwork = connected && chainId !== ONCHAIN_CHAIN.id;

  const run = useCallback(
    async (write: OnchainWrite, cb: RunCallbacks = {}) => {
      if (inFlight.current) return;
      inFlight.current = true;
      dispatch({ type: 'start' });
      const fail = (error: TxError) => {
        dispatch({ type: 'fail', error });
        cb.onFailed?.(error);
      };
      try {
        if (!address || !publicClient) return fail({ kind: 'unknown', message: 'Connect a wallet first.' });
        if (chainId !== ONCHAIN_CHAIN.id) {
          return fail({ kind: 'network', message: 'Switch your wallet to Base Sepolia and try again.' });
        }

        // buildWrite is precisely typed per write (and unit-tested); viem's generics can't take a
        // union of four call shapes, so the call is widened once here. Simulation is a pre-flight:
        // it surfaces reverts as readable reasons before the wallet opens. The wallet then sends
        // the same call and estimates gas itself.
        const call = buildWrite(write);
        try {
          await publicClient.simulateContract({ ...call, account: address } as unknown as SimulateContractParameters);
        } catch (err) {
          return fail(decodeTxError(err, cb.context));
        }
        dispatch({ type: 'simulated' });

        let hash: Hash;
        try {
          hash = await writeContractAsync({ ...call, chainId: ONCHAIN_CHAIN.id } as unknown as Parameters<
            typeof writeContractAsync
          >[0]);
        } catch (err) {
          return fail(decodeTxError(err, cb.context));
        }
        dispatch({ type: 'submitted', hash });
        cb.onSubmitted?.(hash);

        let blockNumber: bigint;
        try {
          // viem resolves with the *replacement's* receipt when the wallet replaces the tx. Only a
          // speed-up ("repriced": same call, higher fee) is our write; a cancel or a different tx
          // in its place means our write never happened.
          let replacedBy: 'cancelled' | 'replaced' | null = null;
          const receipt = await publicClient.waitForTransactionReceipt({
            hash,
            onReplaced: (r) => {
              if (r.reason !== 'repriced') replacedBy = r.reason;
            },
          });
          if (replacedBy) {
            return fail({
              kind: replacedBy === 'cancelled' ? 'rejected' : 'unknown',
              message:
                replacedBy === 'cancelled'
                  ? 'The transaction was cancelled in your wallet. Nothing changed.'
                  : 'The transaction was replaced by a different one in your wallet. Nothing changed.',
            });
          }
          if (receipt.status !== 'success') {
            return fail({ kind: 'revert', message: 'The transaction reverted on-chain. Nothing changed.' });
          }
          blockNumber = receipt.blockNumber;
        } catch (err) {
          if ((err as Error)?.name === 'WaitForTransactionReceiptTimeoutError') {
            return fail({
              kind: 'unknown',
              message: 'Still waiting for the network. The transaction may yet confirm; check it on Basescan.',
            });
          }
          return fail(decodeTxError(err, cb.context));
        }
        dispatch({ type: 'mined', blockNumber });
        cb.onConfirmed?.(hash, blockNumber);

        // Still "in flight" (busy) until this resolves; always ends in a terminal state.
        const caughtUp = await waitForIndexer(blockNumber);
        dispatch({ type: 'indexed', caughtUp });
        cb.onIndexed?.(caughtUp);
      } finally {
        inFlight.current = false;
      }
    },
    [address, chainId, publicClient, writeContractAsync],
  );

  const switchToBase = useCallback(() => switchChainAsync({ chainId: ONCHAIN_CHAIN.id }), [switchChainAsync]);
  const reset = useCallback(() => dispatch({ type: 'reset' }), []);

  // Hydrating, or wagmi restoring a previous session: don't offer "Connect wallet" yet.
  const checking = status === 'reconnecting';
  return { state, run, reset, busy: isBusy(state), connected, checking, address, wrongNetwork, switchToBase, switching };
}

export type { TxState };
