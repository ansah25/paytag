import { db } from "ponder:api";
import schema from "ponder:schema";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { and, eq, graphql, sql } from "ponder";
import { type Hex, getAddress, isAddress } from "viem";
import { RESERVED_NODES } from "../../abis/reservedNodes";
import { COIN_TYPE } from "../lib/codec";
import { normalizeName } from "../lib/names";
import { RateLimiter, positiveInt, rateLimit } from "../lib/rateLimit";
import { buildResolveBody, isLiveReverseClaim } from "../lib/resolve";

// Public, read-only HTTP API over the indexed state. Error bodies follow the Paytag API's
// `{ error, code }` shape so @paytagdev/sdk handles both sources the same way.
// Ponder reserves /health, /ready, /status and /metrics; /status reports the synced block.

const app = new Hono();

// Never let an internal error message reach a client: Ponder's default handler echoes
// error.message, which for an RPC failure includes the RPC URL and its API key. A sub-app's
// onError takes precedence over Ponder's for these routes.
app.onError((err, c) => {
  console.error(`indexer api: ${c.req.method} ${c.req.path} failed:`, err.name);
  return c.json({ error: "Internal error", code: "INTERNAL_ERROR" }, 500);
});

app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "OPTIONS"],
    exposeHeaders: ["Retry-After", "RateLimit-Limit", "RateLimit-Remaining", "RateLimit-Reset"],
  }),
);

// Per-address limits on this API (Ponder's own /health, /ready, /status and /metrics are
// registered before these routes and aren't limited). GraphQL gets a tighter bucket: one query
// can do far more work than a REST lookup. The web app's server-side fetches present
// INDEXER_SERVER_KEY instead, since they all arrive from Vercel's shared addresses.
app.use(
  "*",
  rateLimit({
    rest: new RateLimiter({ perMinute: positiveInt(process.env.RATE_LIMIT_PER_MIN, 120) }),
    graphql: new RateLimiter({ perMinute: positiveInt(process.env.RATE_LIMIT_GRAPHQL_PER_MIN, 60) }),
    serverKey: process.env.INDEXER_SERVER_KEY || undefined,
  }),
);

// Until historical sync completes, tables are partial and every answer would be confidently
// wrong ("not registered", "available"). Gate all routes on the same flag Ponder's /ready reads:
// `is_ready` in this deployment's own _ponder_meta table (the API's connection is scoped to the
// deployment schema). Reading it from the database, not over HTTP, ties the check to this
// instance even when another process holds the expected port. The flag flips once and stays set
// for the life of the process; while unset it's re-read at most every 2s. Fails closed.
let ready = false;
let lastProbe = 0;
async function indexerReady(): Promise<boolean> {
  if (ready) return true;
  if (Date.now() - lastProbe < 2_000) return false;
  lastProbe = Date.now();
  try {
    const result = await db.execute(sql`SELECT value FROM _ponder_meta`);
    const rows = (result as unknown as { rows?: { value: unknown }[] }).rows ?? [];
    ready = rows.some((row) => {
      const value = typeof row.value === "string" ? JSON.parse(row.value) : row.value;
      return (value as { is_ready?: number } | null)?.is_ready === 1;
    });
  } catch {
    // stay not-ready
  }
  return ready;
}

app.use("*", async (c, next) => {
  if (c.req.method === "OPTIONS" || (await indexerReady())) return next();
  c.header("Retry-After", "10");
  return c.json({ error: "Indexer is still syncing; retry shortly", code: "NOT_READY" }, 503);
});

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
    const [[eth], [name]] = await Promise.all([
      db
        .select()
        .from(schema.records)
        .where(and(eq(schema.records.node, claim.node), eq(schema.records.coinType, COIN_TYPE.ETH)))
        .limit(1),
      db.select().from(schema.names).where(eq(schema.names.node, claim.node)).limit(1),
    ]);
    if (name && isLiveReverseClaim(account, eth)) username = name.name;
  }

  c.header("Cache-Control", CACHE_CONTROL);
  return c.json({ address: getAddress(account), username });
});

app.get("/available/:name", async (c) => {
  const parsed = normalizeName(c.req.param("name"));
  if (!parsed.ok) return c.json({ available: false, reason: "INVALID_FORMAT", suggestions: [] });

  if (RESERVED_NODES.has(parsed.node)) {
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
