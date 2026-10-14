import { describe, expect, it } from "vitest";
import { keccak256, stringToBytes } from "viem";
import { RESERVED_NODES } from "../abis/reservedNodes";

// abis/reservedNodes.ts is generated from PaytagRegistry.isReserved and drift-checked against the
// contract source by `npm run abis:check` in CI; this pins its content independently.
describe("RESERVED_NODES", () => {
  it("holds the registry's 28 reserved names", () => {
    expect(RESERVED_NODES.size).toBe(28);
    for (const name of ["paytag", "admin", "support", "api", "www", "resolve", "available"]) {
      expect(RESERVED_NODES.has(keccak256(stringToBytes(name)))).toBe(true);
    }
    expect(RESERVED_NODES.has(keccak256(stringToBytes("derrick")))).toBe(false);
  });
});
