import { type Hex, getAddress } from "viem";
import { COIN_TYPE } from "./codec";

// Pure read-model logic shared by the HTTP API. Kept free of Ponder imports so it can be unit
// tested without a database.

/** Total order over events: (block, logIndex). */
export function ordinal(blockNumber: bigint, logIndex: number): bigint {
  return (blockNumber << 32n) | BigInt(logIndex);
}

export type NameRow = {
  node: Hex;
  name: string;
  owner: Hex;
  registeredAt: bigint;
  lastTransferOrdinal: bigint;
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
  addresses: ChainAddresses;
  records: { coinType: string; value: Hex; address: string | null; stale: boolean }[];
  source: "onchain";
};

const CHAIN_FOR_COIN: Record<string, keyof ChainAddresses> = {
  [COIN_TYPE.ETH.toString()]: "ethereum",
  [COIN_TYPE.SOL.toString()]: "solana",
  [COIN_TYPE.BTC.toString()]: "bitcoin",
};

/**
 * A record is stale when it was written before the name's latest transfer: it was set by a
 * previous owner, and paying it would pay them (README "Known trade-offs"). Stale records are
 * listed in `records` but deliberately left out of `addresses`, which payment flows consume.
 */
export function isStale(record: RecordRow, name: NameRow): boolean {
  return record.updatedOrdinal < name.lastTransferOrdinal;
}

export function buildResolveBody(name: NameRow, rows: RecordRow[]): ResolveBody {
  const addresses: ChainAddresses = {};
  const records = [...rows]
    .sort((a, b) => (a.coinType < b.coinType ? -1 : a.coinType > b.coinType ? 1 : 0))
    .map((r) => {
      const stale = isStale(r, name);
      const chain = CHAIN_FOR_COIN[r.coinType.toString()];
      if (chain && r.address && !stale) addresses[chain] = r.address;
      return { coinType: r.coinType.toString(), value: r.value, address: r.address, stale };
    });

  return {
    username: name.name,
    node: name.node,
    owner: getAddress(name.owner),
    registeredAt: Number(name.registeredAt),
    addresses,
    records,
    source: "onchain",
  };
}

/**
 * A reverse claim counts only while the claimed node's ETH record still equals the claiming
 * account (mirroring PaytagResolver.reverse()) AND that record isn't stale. The second condition
 * is stricter than the contract: after a transfer, the former owner's address must not keep
 * resolving to a name they no longer own, the same reason stale records leave `addresses`.
 */
export function isLiveReverseClaim(
  account: Hex,
  ethRecord: Pick<RecordRow, "value" | "updatedOrdinal"> | undefined,
  name: Pick<NameRow, "lastTransferOrdinal"> | undefined,
): boolean {
  if (!ethRecord || !name) return false;
  return (
    ethRecord.value.toLowerCase() === account.toLowerCase() &&
    ethRecord.updatedOrdinal >= name.lastTransferOrdinal
  );
}
