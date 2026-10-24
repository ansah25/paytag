import { keccak256, stringToBytes } from "viem";
import { normalizeName } from "../../src/onchain/names";

// Reference: the contract's rule, written as a regex over the lowercased-ASCII form.
const reference = (raw: string) => {
  const input = raw.startsWith("@") ? raw.slice(1) : raw;
  const lowered = input.replace(/[A-Z]/g, (c) => c.toLowerCase());
  return /^[a-z0-9_]{3,20}$/.test(lowered) ? lowered : null;
};

describe("normalizeName", () => {
  it("matches the registry's node for a known name", () => {
    const r = normalizeName("Derrick");
    expect(r).toEqual({
      ok: true,
      name: "derrick",
      node: "0x2209a34bc4a111dcc71330ec4d9d1b6e134efb0c184da8e95f7da20375fa46ae",
    });
  });

  it("strips a leading @", () => {
    expect(normalizeName("@derrick")).toMatchObject({ ok: true, name: "derrick" });
  });

  it.each(["ab", "a".repeat(21), "der rick", "der-rick", "café", "Kelvin", "pаypal", ""])(
    "rejects %j",
    (raw) => {
      expect(normalizeName(raw).ok).toBe(false);
    },
  );

  it("agrees with the reference rule on random strings", () => {
    const alphabet = "abcXYZ019_-. @éK";
    let seed = 42;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    for (let i = 0; i < 5000; i++) {
      const len = Math.floor(rand() * 24);
      let s = "";
      for (let j = 0; j < len; j++) s += alphabet[Math.floor(rand() * alphabet.length)];
      const expected = reference(s);
      const actual = normalizeName(s);
      if (expected === null) {
        expect({ input: s, ok: actual.ok }).toEqual({ input: s, ok: false });
      } else {
        expect(actual).toEqual({ ok: true, name: expected, node: keccak256(stringToBytes(expected)) });
      }
    }
  });
});
