import { describe, expect, it } from "vitest";
import { RateLimiter, clientKey, hasServerKey, positiveInt } from "../src/lib/rateLimit";

const clock = (start = 0) => {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
};

describe("RateLimiter", () => {
  it("allows a burst of perMinute, then refuses with a retry hint", () => {
    const c = clock();
    const rl = new RateLimiter({ perMinute: 3 }, c.now);
    expect([rl.check("a"), rl.check("a"), rl.check("a")].map((d) => d.allowed)).toEqual([true, true, true]);
    const denied = rl.check("a");
    expect(denied).toMatchObject({ allowed: false, limit: 3, remaining: 0 });
    expect(denied.retryAfter).toBe(20); // 3/min refills one every 20s
  });

  it("refills over time, never above the limit", () => {
    const c = clock();
    const rl = new RateLimiter({ perMinute: 60 }, c.now);
    for (let i = 0; i < 60; i++) rl.check("a");
    expect(rl.check("a").allowed).toBe(false);
    c.advance(1_000);
    expect(rl.check("a").allowed).toBe(true);
    c.advance(10 * 60_000);
    expect(rl.check("a").remaining).toBe(59);
  });

  it("keeps clients independent", () => {
    const rl = new RateLimiter({ perMinute: 1 }, clock().now);
    expect(rl.check("a").allowed).toBe(true);
    expect(rl.check("a").allowed).toBe(false);
    expect(rl.check("b").allowed).toBe(true);
  });

  it("drops idle clients once it tracks many", () => {
    const c = clock();
    const rl = new RateLimiter({ perMinute: 10 }, c.now);
    for (let i = 0; i <= 10_001; i++) rl.check(`ip${i}`);
    c.advance(60_000); // every bucket is full again
    rl.check("fresh");
    expect(rl.size).toBe(1);
  });
});

describe("clientKey", () => {
  it("uses the rightmost X-Forwarded-For hop, the one the proxy appended", () => {
    expect(clientKey("6.6.6.6, 203.0.113.9", "10.0.0.2")).toBe("203.0.113.9");
    expect(clientKey(" 203.0.113.9 ", undefined)).toBe("203.0.113.9");
  });

  it("falls back to the socket address, then a shared key", () => {
    expect(clientKey(undefined, "127.0.0.1")).toBe("127.0.0.1");
    expect(clientKey(" , ", "127.0.0.1")).toBe("127.0.0.1");
    expect(clientKey(undefined, undefined)).toBe("unknown");
  });
});

describe("hasServerKey", () => {
  it("matches only the configured key", () => {
    expect(hasServerKey("s3cret", "s3cret")).toBe(true);
    expect(hasServerKey("s3cret!", "s3cret")).toBe(false);
    expect(hasServerKey("nope00", "s3cret")).toBe(false);
    expect(hasServerKey(undefined, "s3cret")).toBe(false);
  });

  it("never bypasses when no key is configured", () => {
    expect(hasServerKey("", undefined)).toBe(false);
    expect(hasServerKey("anything", undefined)).toBe(false);
    expect(hasServerKey("", "")).toBe(false);
  });
});

describe("positiveInt", () => {
  it("parses positive integers and falls back otherwise", () => {
    expect(positiveInt("200", 120)).toBe(200);
    expect(positiveInt(undefined, 120)).toBe(120);
    expect(positiveInt("0", 120)).toBe(120);
    expect(positiveInt("1.5", 120)).toBe(120);
    expect(positiveInt("abc", 120)).toBe(120);
  });
});
