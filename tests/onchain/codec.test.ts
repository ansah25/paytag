import type { Hex } from "viem";
import { decodeAddress, encodeAddress, isEvmCoinType } from "../../src/onchain/codec";
import vectors from "./vectors.json";

describe("codec: shared ENSIP-9 vectors", () => {
  it.each(vectors.valid)("$label decodes", ({ coinType, address, value }) => {
    expect(decodeAddress(BigInt(coinType), value as Hex)).toBe(address);
  });

  it.each(vectors.valid)("$label encodes", ({ coinType, address, value }) => {
    expect(encodeAddress(BigInt(coinType), address)).toBe(value);
  });

  it.each(vectors.invalidAddresses)("rejects $label", ({ coinType, address }) => {
    expect(() => encodeAddress(BigInt(coinType), address)).toThrow();
  });

  it.each(vectors.undecodableValues)("returns null for $label", ({ coinType, value }) => {
    expect(decodeAddress(BigInt(coinType), value as Hex)).toBeNull();
  });
});

describe("codec: edge cases", () => {
  it("returns null for empty bytes on every coin type", () => {
    for (const coinType of [0n, 60n, 501n, 2147492101n]) {
      expect(decodeAddress(coinType, "0x")).toBeNull();
    }
  });

  it("accepts all-uppercase bech32 input but encodes canonical lowercase", () => {
    const v = vectors.valid.find((x) => x.label.includes("P2WPKH"))!;
    expect(encodeAddress(0n, v.address.toUpperCase())).toBe(v.value);
  });

  it("checksums EVM output regardless of input case", () => {
    expect(decodeAddress(60n, "0x3dbc9c0bef8b7bfbcf0a7cc4041b3962b126f865")).toBe(
      "0x3Dbc9C0Bef8b7bFBcf0a7cc4041b3962B126F865",
    );
  });

  it("treats ENSIP-11 coin types as EVM", () => {
    expect(isEvmCoinType(60n)).toBe(true);
    expect(isEvmCoinType(0x80000000n | 8453n)).toBe(true);
    expect(isEvmCoinType(0n)).toBe(false);
    expect(isEvmCoinType(501n)).toBe(false);
    expect(isEvmCoinType(0xffffffffn)).toBe(true); // max ENSIP-11 value
    expect(isEvmCoinType(0x100000000n | 0x80000000n)).toBe(false); // bit 31 set, but > 32 bits
  });

  it("accepts all-lowercase and all-uppercase EVM addresses", () => {
    expect(encodeAddress(60n, "0x3dbc9c0bef8b7bfbcf0a7cc4041b3962b126f865")).toBe(
      "0x3dbc9c0bef8b7bfbcf0a7cc4041b3962b126f865",
    );
    expect(encodeAddress(60n, "0x3DBC9C0BEF8B7BFBCF0A7CC4041B3962B126F865")).toBe(
      "0x3dbc9c0bef8b7bfbcf0a7cc4041b3962b126f865",
    );
  });
});
