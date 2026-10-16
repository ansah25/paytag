import { describe, expect, it } from "vitest";
import type { Hex } from "viem";
import { type NameRow, type RecordRow, buildResolveBody, isLiveReverseClaim, ordinal } from "../src/lib/resolve";

const NODE = "0x2209a34bc4a111dcc71330ec4d9d1b6e134efb0c184da8e95f7da20375fa46ae" as Hex;
const ALICE = "0x3dbc9c0bef8b7bfbcf0a7cc4041b3962b126f865" as Hex;
const BOB = "0x00000000000000000000000000000000000000b0" as Hex;

const name = (epoch = 0n): NameRow => ({
  node: NODE,
  name: "derrick",
  owner: ALICE,
  registeredAt: 1_790_000_000n,
  epoch,
});

const record = (coinType: bigint, address: string | null): RecordRow => ({
  node: NODE,
  coinType,
  value: "0x01",
  address,
  updatedOrdinal: ordinal(2n, 0),
});

describe("ordinal", () => {
  it("orders by block, then log index", () => {
    expect(ordinal(10n, 5)).toBeLessThan(ordinal(10n, 6));
    expect(ordinal(10n, 2 ** 31)).toBeLessThan(ordinal(11n, 0));
  });
});

describe("buildResolveBody", () => {
  it("maps known coin types to chain names and checksums the owner", () => {
    const body = buildResolveBody(name(), [
      record(60n, "0x3Dbc9C0Bef8b7bFBcf0a7cc4041b3962B126F865"),
      record(501n, "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
      record(0n, "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4"),
    ]);
    expect(body.addresses).toEqual({
      ethereum: "0x3Dbc9C0Bef8b7bFBcf0a7cc4041b3962B126F865",
      solana: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      bitcoin: "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
    });
    expect(body.owner).toBe("0x3Dbc9C0Bef8b7bFBcf0a7cc4041b3962B126F865");
    expect(body.source).toBe("onchain");
    expect(body.records.map((r) => r.coinType)).toEqual(["0", "60", "501"]);
    expect(body.records[0]).not.toHaveProperty("stale");
  });

  it("lists undecodable and non-standard coin types in records only", () => {
    const body = buildResolveBody(name(), [record(60n, null), record(2147492101n, "0xbase")]);
    expect(body.addresses).toEqual({});
    expect(body.records).toHaveLength(2);
  });

  it("reports the epoch, and recordsReset only after a transfer with nothing set since", () => {
    expect(buildResolveBody(name(0n), [])).toMatchObject({ epoch: 0, recordsReset: false }); // never set
    expect(buildResolveBody(name(2n), [])).toMatchObject({ epoch: 2, recordsReset: true }); // reset
    expect(buildResolveBody(name(2n), [record(501n, "SoL")])).toMatchObject({ epoch: 2, recordsReset: false });
  });
});

describe("isLiveReverseClaim", () => {
  const eth = (value: Hex) => ({ value });

  it("is live while the claimed node's current ETH record is the account, in any case", () => {
    expect(isLiveReverseClaim(ALICE, eth(ALICE))).toBe(true);
    expect(isLiveReverseClaim(ALICE, eth("0x3DBC9C0BEF8B7BFBCF0A7CC4041B3962B126F865" as Hex))).toBe(true);
  });

  it("is dead when the ETH record points elsewhere, or is gone (cleared, or dropped by a transfer)", () => {
    expect(isLiveReverseClaim(ALICE, eth(BOB))).toBe(false);
    expect(isLiveReverseClaim(ALICE, undefined)).toBe(false);
  });
});
