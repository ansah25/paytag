import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { RateLimiter, clientKey, hasServerKey, positiveInt, rateLimit, serverKeysFromEnv } from "../src/lib/rateLimit";

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

  it("scans for idle clients at most every 10s, not on every check", () => {
    const c = clock();
    const rl = new RateLimiter({ perMinute: 10 }, c.now);
    const scan = vi.spyOn(rl as unknown as { prune: (t: number) => void }, "prune");
    // Every bucket is busy (each just spent a token), so scans free nothing and the map stays big.
    for (let i = 0; i <= 10_001; i++) rl.check(`ip${i}`);
    for (let i = 0; i < 100; i++) rl.check(`more${i}`);
    expect(scan).toHaveBeenCalledTimes(1);
    c.advance(10_000);
    rl.check("later");
    expect(scan).toHaveBeenCalledTimes(2);
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
  it("matches only a configured key", () => {
    expect(hasServerKey("s3cret", ["s3cret"])).toBe(true);
    expect(hasServerKey("s3cret!", ["s3cret"])).toBe(false);
    expect(hasServerKey("nope00", ["s3cret"])).toBe(false);
    expect(hasServerKey(undefined, ["s3cret"])).toBe(false);
  });

  it("accepts any of several per-consumer keys", () => {
    const keys = ["vercel-key", "fly-key-00"];
    expect(hasServerKey("vercel-key", keys)).toBe(true);
    expect(hasServerKey("fly-key-00", keys)).toBe(true);
    expect(hasServerKey("other-key0", keys)).toBe(false);
  });

  it("never bypasses when no key is configured", () => {
    expect(hasServerKey("", [])).toBe(false);
    expect(hasServerKey("anything", [])).toBe(false);
    expect(hasServerKey("", [""])).toBe(false);
  });
});

describe("serverKeysFromEnv", () => {
  it("splits the list, keeps the legacy key, drops blanks and duplicates", () => {
    expect(serverKeysFromEnv(" a1 , b2,,", "c3")).toEqual(["a1", "b2", "c3"]);
    expect(serverKeysFromEnv("a1", "a1")).toEqual(["a1"]);
    expect(serverKeysFromEnv(undefined, undefined)).toEqual([]);
    expect(serverKeysFromEnv("", " ")).toEqual([]);
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

describe("rateLimit middleware", () => {
  const build = (serverKey?: string) => {
    const app = new Hono();
    app.use(
      "*",
      rateLimit({
        rest: new RateLimiter({ perMinute: 2 }, clock().now),
        graphql: new RateLimiter({ perMinute: 1 }, clock().now),
        serverKeys: serverKey ? [serverKey] : [],
      }),
    );
    app.all("*", (c) => c.text("ok"));
    return app;
  };
  const from = (ip: string, extra: Record<string, string> = {}) => ({ headers: { "x-forwarded-for": ip, ...extra } });

  it("limits per address with headers, then answers 429 in the API's shape", async () => {
    const app = build();
    const first = await app.request("/resolve/x", from("1.1.1.1"));
    expect(first.status).toBe(200);
    expect(first.headers.get("RateLimit-Limit")).toBe("2");
    expect(first.headers.get("RateLimit-Remaining")).toBe("1");
    await app.request("/resolve/x", from("1.1.1.1"));
    const denied = await app.request("/resolve/x", from("1.1.1.1"));
    expect(denied.status).toBe(429);
    expect(denied.headers.get("Retry-After")).toBe("30");
    expect(await denied.json()).toEqual({ error: expect.any(String), code: "RATE_LIMITED" });
    expect((await app.request("/resolve/x", from("2.2.2.2"))).status).toBe(200);
  });

  it("keys on the rightmost forwarded hop, so a forged left entry doesn't help", async () => {
    const app = build();
    await app.request("/a", from("1.1.1.1"));
    await app.request("/a", from("1.1.1.1"));
    expect((await app.request("/a", from("9.9.9.9, 1.1.1.1"))).status).toBe(429);
  });

  it("uses a separate GraphQL bucket", async () => {
    const app = build();
    expect((await app.request("/graphql", { method: "POST", ...from("1.1.1.1") })).status).toBe(200);
    expect((await app.request("/graphql", { method: "POST", ...from("1.1.1.1") })).status).toBe(429);
    expect((await app.request("/resolve/x", from("1.1.1.1"))).status).toBe(200);
  });

  it("lets preflight and server-key callers through unmetered", async () => {
    const app = build("k3y");
    for (let i = 0; i < 5; i++) {
      expect((await app.request("/a", { method: "OPTIONS", ...from("1.1.1.1") })).status).toBe(200);
      const keyed = await app.request("/a", from("1.1.1.1", { "x-paytag-server-key": "k3y" }));
      expect(keyed.status).toBe(200);
      expect(keyed.headers.get("RateLimit-Limit")).toBeNull();
    }
    expect((await app.request("/a", from("1.1.1.1", { "x-paytag-server-key": "nope" }))).status).toBe(200);
    expect((await app.request("/a", from("1.1.1.1"))).status).toBe(200);
    expect((await app.request("/a", from("1.1.1.1"))).status).toBe(429);
  });
});
