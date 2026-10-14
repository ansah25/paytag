import { db, publicClients } from "ponder:api";
import schema from "ponder:schema";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { and, eq, graphql } from "ponder";
import { type Hex, getAddress, isAddress } from "viem";
import { PaytagRegistryAbi } from "../../abis/PaytagRegistryAbi";
import { REGISTRY_ADDRESS } from "../../deployment";
import { COIN_TYPE } from "../lib/codec";
import { normalizeName } from "../lib/names";
import { buildResolveBody, isLiveReverseClaim } from "../lib/resolve";

// Public, read-only HTTP API over the indexed state. Error bodies follow the Paytag API's
// `{ error, code }` shape so @paytagdev/sdk handles both sources the same way.
// Ponder reserves /health, /ready, /status and /metrics; /status reports the synced block.

const app = new Hono();

app.use("*", cors({ origin: "*", allowMethods: ["GET", "POST", "OPTIONS"] }));
app.use("/graphql", graphql({ db, schema }));

// Indexed state moves every block; keep edge caching short.
const CACHE_CONTROL = "public, max-age=5, stale-while-revalidate=10";

const fail = (status: 400 | 404, code: string, error: string) =>
  Response.json({ error, code }, { status });

app.get("/resolve/:name", async (c) => {
  const parsed = normalizeName(c.req.param("name"));
  if (!parsed.ok) return fail(400, "INVALID_USERNAME", `Invalid username: ${parsed.reason}`);

  const [name] = await db.select().from(schema.names).where(eq(schema.names.node, parsed.node)).limit(1);
  if (!name) return fail(404, "USER_NOT_FOUND", `@${parsed.name} is not registered on-chain`);

  const rows = await db.select().from(schema.records).where(eq(schema.records.node, name.node));
  c.header("Cache-Control", CACHE_CONTROL);
  return c.json(buildResolveBody(name, rows));
});

app.get("/reverse/:address", async (c) => {
  const raw = c.req.param("address");
  if (!isAddress(raw, { strict: false })) return fail(400, "INVALID_ADDRESS", "Invalid EVM address");
  const account = raw.toLowerCase() as Hex;

  const [claim] = await db
    .select()
    .from(schema.reverseClaims)
    .where(eq(schema.reverseClaims.account, account))
    .limit(1);

  let username: string | null = null;
  if (claim) {
    const [eth] = await db
      .select()
      .from(schema.records)
      .where(and(eq(schema.records.node, claim.node), eq(schema.records.coinType, COIN_TYPE.ETH)))
      .limit(1);
    if (isLiveReverseClaim(account, eth?.value)) {
      const [name] = await db.select().from(schema.names).where(eq(schema.names.node, claim.node)).limit(1);
      username = name?.name ?? null;
    }
  }

  c.header("Cache-Control", CACHE_CONTROL);
  return c.json({ address: getAddress(account), username });
});

// The reserved list is a pure function of the node and fixed at deploy time, so each answer
// from the registry is cached for the life of the process.
const reservedCache = new Map<Hex, boolean>();
async function isReserved(node: Hex): Promise<boolean> {
  const cached = reservedCache.get(node);
  if (cached !== undefined) return cached;
  const reserved = await publicClients.baseSepolia.readContract({
    address: REGISTRY_ADDRESS,
    abi: PaytagRegistryAbi,
    functionName: "isReserved",
    args: [node],
  });
  reservedCache.set(node, reserved);
  return reserved;
}

app.get("/available/:name", async (c) => {
  const parsed = normalizeName(c.req.param("name"));
  if (!parsed.ok) return c.json({ available: false, reason: "INVALID_FORMAT", suggestions: [] });

  if (await isReserved(parsed.node)) {
    return c.json({ available: false, reason: "RESERVED", suggestions: await suggest(parsed.name) });
  }
  const [taken] = await db.select().from(schema.names).where(eq(schema.names.node, parsed.node)).limit(1);
  if (taken) return c.json({ available: false, reason: "TAKEN", suggestions: await suggest(parsed.name) });
  return c.json({ available: true, suggestions: [] });
});

// Suggestions contain a digit or underscore, which no reserved name does, so they never need
// the on-chain reserved check.
async function suggest(base: string): Promise<string[]> {
  const candidates = [`${base}_`, `${base}1`, `${base}_pay`, `${base}2`]
    .map((n) => normalizeName(n))
    .filter((r) => r.ok);
  const free: string[] = [];
  for (const candidate of candidates) {
    const [taken] = await db
      .select({ node: schema.names.node })
      .from(schema.names)
      .where(eq(schema.names.node, candidate.node))
      .limit(1);
    if (!taken) free.push(candidate.name);
    if (free.length === 3) break;
  }
  return free;
}

app.get("/names", async (c) => {
  const owner = c.req.query("owner");
  if (!owner || !isAddress(owner, { strict: false })) {
    return fail(400, "INVALID_ADDRESS", "Query parameter `owner` must be an EVM address");
  }
  const rows = await db
    .select({ name: schema.names.name, node: schema.names.node, registeredAt: schema.names.registeredAt })
    .from(schema.names)
    .where(eq(schema.names.owner, owner.toLowerCase() as Hex));

  c.header("Cache-Control", CACHE_CONTROL);
  return c.json({
    owner: getAddress(owner),
    names: rows
      .map((r) => ({ name: r.name, node: r.node, registeredAt: Number(r.registeredAt) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  });
});

export default app;
