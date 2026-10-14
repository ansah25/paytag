import { describe, expect, it } from "vitest";
import type { Hex } from "viem";
import { type NameRow, type RecordRow, buildResolveBody, isLiveReverseClaim, ordinal } from "../src/lib/resolve";

const NODE = "0x2209a34bc4a111dcc71330ec4d9d1b6e134efb0c184da8e95f7da20375fa46ae" as Hex;
const ALICE = "0x3dbc9c0bef8b7bfbcf0a7cc4041b3962b126f865" as Hex;
const BOB = "0x00000000000000000000000000000000000000b0" as Hex;

const name = (lastTransferOrdinal: bigint): NameRow => ({
  node: NODE,
  name: "derrick",
  owner: ALICE,
  registeredAt: 1_790_000_000n,
  lastTransferOrdinal,
});

const record = (coinType: bigint, address: string | null, updatedOrdinal: bigint): RecordRow => ({
  node: NODE,
  coinType,
  value: "0x01",
  address,
  updatedOrdinal,
});

describe("ordinal", () => {
  it("orders by block, then log index", () => {
    expect(ordinal(10n, 5)).toBeLessThan(ordinal(10n, 6));
    expect(ordinal(10n, 2 ** 31)).toBeLessThan(ordinal(11n, 0));
  });
});

describe("buildResolveBody", () => {
  it("maps known coin types to chain names and checksums the owner", () => {
    const body = buildResolveBody(name(ordinal(1n, 0)), [
      record(60n, "0x3Dbc9C0Bef8b7bFBcf0a7cc4041b3962B126F865", ordinal(2n, 0)),
      record(501n, "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", ordinal(2n, 1)),
      record(0n, "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4", ordinal(2n, 2)),
    ]);
    expect(body.addresses).toEqual({
      ethereum: "0x3Dbc9C0Bef8b7bFBcf0a7cc4041b3962B126F865",
      solana: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      bitcoin: "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
    });
    expect(body.owner).toBe("0x3Dbc9C0Bef8b7bFBcf0a7cc4041b3962B126F865");
    expect(body.source).toBe("onchain");
    expect(body.records.map((r) => r.coinType)).toEqual(["0", "60", "501"]);
  });

  it("keeps records written before the latest transfer out of addresses and flags them", () => {
    const transferredAt = ordinal(5n, 3);
    const body = buildResolveBody(name(transferredAt), [
      record(60n, "0xold", ordinal(5n, 2)), // same block, earlier log: previous owner wrote it
      record(501n, "SoLnew", ordinal(5n, 4)), // after the transfer: current owner wrote it
    ]);
    expect(body.addresses).toEqual({ solana: "SoLnew" });
    expect(body.records.find((r) => r.coinType === "60")?.stale).toBe(true);
    expect(body.records.find((r) => r.coinType === "501")?.stale).toBe(false);
  });

  it("lists undecodable and non-standard coin types in records only", () => {
    const body = buildResolveBody(name(0n), [record(60n, null, 1n), record(2147492101n, "0xbase", 1n)]);
    expect(body.addresses).toEqual({});
    expect(body.records).toHaveLength(2);
  });
});

describe("isLiveReverseClaim", () => {
  const transferredAt = { lastTransferOrdinal: ordinal(5n, 3) };
  const eth = (value: Hex, updatedOrdinal: bigint) => ({ value, updatedOrdinal });

  it("is live while the claimed node's current ETH record is the account", () => {
    expect(isLiveReverseClaim(ALICE, eth(ALICE, ordinal(6n, 0)), transferredAt)).toBe(true);
    expect(
      isLiveReverseClaim(ALICE, eth("0x3DBC9C0BEF8B7BFBCF0A7CC4041B3962B126F865" as Hex, ordinal(6n, 0)), transferredAt),
    ).toBe(true);
  });

  it("is dead when the ETH record points elsewhere or is missing", () => {
    expect(isLiveReverseClaim(ALICE, eth(BOB, ordinal(6n, 0)), transferredAt)).toBe(false);
    expect(isLiveReverseClaim(ALICE, undefined, transferredAt)).toBe(false);
    expect(isLiveReverseClaim(ALICE, eth(ALICE, ordinal(6n, 0)), undefined)).toBe(false);
  });

  it("is dead when the ETH record predates the latest transfer (stricter than the contract)", () => {
    expect(isLiveReverseClaim(ALICE, eth(ALICE, ordinal(5n, 2)), transferredAt)).toBe(false);
  });
});
