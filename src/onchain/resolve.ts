import { type Hex, getAddress } from "viem";
import { COIN_TYPE } from "./codec";

// Pure response-building logic for the on-chain endpoints. Kept free of I/O so it can be unit
// tested without a chain or a database.

/** Total order over events: (block, logIndex). */
export function ordinal(blockNumber: bigint, logIndex: number): bigint {
  return (blockNumber << 32n) | BigInt(logIndex);
}

export type NameRow = {
  node: Hex;
  name: string;
  owner: Hex;
  registeredAt: bigint;
  epoch: bigint;
};

export type RecordRow = {
  node: Hex;
  coinType: bigint;
  value: Hex;
  address: string | null;
  updatedOrdinal: bigint;
};

export type ChainAddresses = Partial<Record<"ethereum" | "solana" | "bitcoin", string>>;

export type ResolveBody = {
  username: string;
  node: Hex;
  owner: string;
  registeredAt: number;
  /** Transfers to a different owner so far. Records only exist for the current epoch. */
  epoch: number;
  /**
   * True when the name has changed owner and the current owner hasn't set any record since:
   * "unconfigured after a transfer", as opposed to a name that never had records.
   */
  recordsReset: boolean;
  addresses: ChainAddresses;
  records: { coinType: string; value: Hex; address: string | null }[];
  source: "onchain";
};

const CHAIN_FOR_COIN: Record<string, keyof ChainAddresses> = {
  [COIN_TYPE.ETH.toString()]: "ethereum",
  [COIN_TYPE.SOL.toString()]: "solana",
  [COIN_TYPE.BTC.toString()]: "bitcoin",
};

/**
 * The records rows are exactly the name's current-epoch records: they're read from the resolver,
 * which only answers for the name's current epoch (a transfer starts a new one). So every record
 * here was set by the current owner and is safe to pay.
 */
export function buildResolveBody(name: NameRow, rows: RecordRow[]): ResolveBody {
  const addresses: ChainAddresses = {};
  const records = [...rows]
    .sort((a, b) => (a.coinType < b.coinType ? -1 : a.coinType > b.coinType ? 1 : 0))
    .map((r) => {
      const chain = CHAIN_FOR_COIN[r.coinType.toString()];
      if (chain && r.address) addresses[chain] = r.address;
      return { coinType: r.coinType.toString(), value: r.value, address: r.address };
    });

  return {
    username: name.name,
    node: name.node,
    owner: getAddress(name.owner),
    registeredAt: Number(name.registeredAt),
    epoch: Number(name.epoch),
    recordsReset: name.epoch > 0n && records.length === 0,
    addresses,
    records,
    source: "onchain",
  };
}

/**
 * A reverse claim counts only while the claimed node's current ETH record equals the claiming
 * account, exactly as PaytagResolver.reverse() checks it. A transfer deletes the old epoch's
 * records, so a previous owner's claim goes dark at the transfer, as on-chain.
 */
export function isLiveReverseClaim(account: Hex, ethRecord: Pick<RecordRow, "value"> | undefined): boolean {
  return !!ethRecord && ethRecord.value.toLowerCase() === account.toLowerCase();
}
