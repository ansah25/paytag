import { type Hex, parseAbi, zeroAddress, zeroHash } from 'viem';
import { AppError } from '../utils/errors';
import { logger } from '../utils/logger';
import { chainClient } from './client';
import { COIN_TYPE } from './codec';
import { REGISTRY_ADDRESS, RESOLVER_ADDRESS } from './deployment';
import { PaytagRegistryAbi } from './generated/PaytagRegistryAbi';
import { PaytagResolverAbi } from './generated/PaytagResolverAbi';

// Direct reads of current contract state, batched through Multicall3 so a lookup is one round
// trip. Current state is reorg-immune in the sense that matters here: it is whatever the chain
// says now, never a copy that can lag behind it.

/** Multicall3 on Base Sepolia (the same address on every chain it's deployed to). */
export const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11' as const;
/** viem's bundled multicall3Abi leaves this function out. */
export const MULTICALL3_BLOCK_ABI = parseAbi(['function getBlockNumber() view returns (uint256 blockNumber)']);

/** Base mainnet's ENSIP-11 coin type: the records the web app writes are ETH, Base, SOL, BTC. */
export const BASE_COIN_TYPE = 0x80000000n | 8453n;

/**
 * The record coin types read directly. The contract can't enumerate a name's records, so these are
 * the ones the web app writes; a record set for any other coin type isn't returned.
 */
export const READ_COIN_TYPES: readonly bigint[] = [COIN_TYPE.BTC, COIN_TYPE.ETH, COIN_TYPE.SOL, BASE_COIN_TYPE];

/** The chain couldn't be read (every RPC failed or timed out), or it's behind what was asked. */
export class ChainUnavailableError extends AppError {
  constructor(message = 'On-chain state is unavailable right now; retry shortly', code = 'ONCHAIN_UNAVAILABLE') {
    super(503, code, message);
    this.name = 'ChainUnavailableError';
  }
}

/** One name's current state. `owner` is lowercase, or null when the name isn't registered. */
export interface NameState {
  node: Hex;
  owner: Hex | null;
  epoch: bigint;
  /** Non-empty records among READ_COIN_TYPES (empty bytes mean unset). */
  records: { coinType: bigint; value: Hex }[];
}

export interface Read<T> {
  value: T;
  /** The block the read was taken at. */
  block: bigint;
}

export interface ReadOptions {
  /** The read must reflect at least this block (a write the caller just made). */
  minBlock?: bigint;
  /** Fewer calls when only ownership matters (list verification). */
  ownersOnly?: boolean;
}

const MIN_BLOCK_RETRY_MS = 1_000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs `contracts` in one multicall with Multicall3.getBlockNumber() first, so every result
 * carries the block it was read at. Any RPC failure becomes ChainUnavailableError.
 */
async function multicallAt(contracts: readonly unknown[]): Promise<{ block: bigint; results: unknown[] }> {
  try {
    const [block, ...results] = (await chainClient().multicall({
      // viem's multicall typing wants a literal tuple; the calls are built dynamically here.
      contracts: [
        { address: MULTICALL3, abi: MULTICALL3_BLOCK_ABI, functionName: 'getBlockNumber' },
        ...contracts,
      ] as never,
      allowFailure: false,
      multicallAddress: MULTICALL3,
      // One eth_call for every lookup the API makes (viem would split above 1 KB of calldata).
      batchSize: 64 * 1024,
    })) as unknown[];
    return { block: block as bigint, results };
  } catch (err) {
    if (err instanceof AppError) throw err;
    // Only the error's name: viem's messages carry the RPC URL, and the fallback's has a key.
    logger.warn('onchain.rpc_failed', { what: 'multicall', reason: (err as Error)?.name ?? 'unknown' });
    throw new ChainUnavailableError();
  }
}

/** A read, retried once if the RPC answered from before `minBlock`. */
async function atLeast<T>(minBlock: bigint | undefined, read: () => Promise<Read<T>>): Promise<Read<T>> {
  const first = await read();
  if (minBlock === undefined || first.block >= minBlock) return first;
  await sleep(MIN_BLOCK_RETRY_MS);
  const second = await read();
  if (second.block >= minBlock) return second;
  throw new ChainUnavailableError(`The chain hasn't reached block ${minBlock} yet; retry shortly`, 'ONCHAIN_BEHIND');
}

const ownerOf = (raw: string): Hex | null => (raw === zeroAddress ? null : (raw.toLowerCase() as Hex));

/** Current owner, epoch and (unless `ownersOnly`) records of each node, in one round trip. */
export function readNames(nodes: readonly Hex[], opts: ReadOptions = {}): Promise<Read<NameState[]>> {
  const coinTypes = opts.ownersOnly ? [] : READ_COIN_TYPES;
  const perNode = 1 + coinTypes.length;
  return atLeast(opts.minBlock, async () => {
    const calls = nodes.flatMap((node) => [
      { address: REGISTRY_ADDRESS, abi: PaytagRegistryAbi, functionName: 'ownerAndEpoch', args: [node] },
      ...coinTypes.map((coinType) => ({
        address: RESOLVER_ADDRESS,
        abi: PaytagResolverAbi,
        functionName: 'addr',
        args: [node, coinType],
      })),
    ]);
    const { block, results } = await multicallAt(calls);
    const value = nodes.map((node, i): NameState => {
      const [owner, epoch] = results[i * perNode] as readonly [string, bigint];
      const records = coinTypes
        .map((coinType, j) => ({ coinType, value: results[i * perNode + 1 + j] as Hex }))
        .filter((r) => r.value !== '0x');
      return { node, owner: ownerOf(owner), epoch, records };
    });
    return { value, block };
  });
}

/** The node `account` has a live reverse claim on (the resolver verifies it), or null. */
export function readReverse(account: Hex, opts: ReadOptions = {}): Promise<Read<Hex | null>> {
  return atLeast(opts.minBlock, async () => {
    const { block, results } = await multicallAt([
      { address: RESOLVER_ADDRESS, abi: PaytagResolverAbi, functionName: 'reverse', args: [account] },
    ]);
    const node = results[0] as Hex;
    return { value: node === zeroHash ? null : node, block };
  });
}

/** The current ETH record of each node (lowercase), or null when unset; plus each owner. */
export function readEthRecords(
  nodes: readonly Hex[],
  opts: ReadOptions = {},
): Promise<Read<{ node: Hex; owner: Hex | null; eth: Hex | null }[]>> {
  return atLeast(opts.minBlock, async () => {
    const calls = nodes.flatMap((node) => [
      { address: REGISTRY_ADDRESS, abi: PaytagRegistryAbi, functionName: 'ownerAndEpoch', args: [node] },
      { address: RESOLVER_ADDRESS, abi: PaytagResolverAbi, functionName: 'addr', args: [node, COIN_TYPE.ETH] },
    ]);
    const { block, results } = await multicallAt(calls);
    const value = nodes.map((node, i) => {
      const [owner] = results[i * 2] as readonly [string, bigint];
      const eth = results[i * 2 + 1] as Hex;
      return { node, owner: ownerOf(owner), eth: eth === '0x' ? null : (eth.toLowerCase() as Hex) };
    });
    return { value, block };
  });
}

/** Latest block, for the sync. */
export async function readHead(): Promise<bigint> {
  try {
    return await chainClient().getBlockNumber({ cacheTime: 0 });
  } catch {
    throw new ChainUnavailableError();
  }
}
