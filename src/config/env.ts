import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('24h'),

  // Hosts the sign-in (SIWE) message may name as its domain, comma-separated, e.g.
  // "www.paytag.dev,paytag.dev". Required in production; see the check below.
  SIWE_DOMAINS: z.string().optional(),

  NONCE_TTL_SECONDS: z.coerce.number().int().positive().default(300),

  // Comma-separated list of allowed origins, e.g.
  //   "https://paytag.dev,https://www.paytag.dev"
  // Leave unset in dev to allow any origin.
  CORS_ORIGIN: z.string().optional(),

  // On-chain reads (Base Sepolia). The primary RPC is the public endpoint in
  // src/onchain/generated/endpoints.ts; this is the fallback, typically a keyed provider URL
  // (Alchemy). It holds a secret: server-side only, never in the CSP or the web bundle.
  BASE_SEPOLIA_RPC_FALLBACK_URL: z.string().url().startsWith('https://').optional(),
  // Etherscan-compatible logs API used to catch the events table up in one call per contract.
  // When it fails, the sync falls back to eth_getLogs in ONCHAIN_LOG_CHUNK_BLOCKS chunks.
  BLOCKSCOUT_API_URL: z.string().url().startsWith('https://').default('https://base-sepolia.blockscout.com'),
  // eth_getLogs range per call on the fallback path (sepolia.base.org allows 200).
  ONCHAIN_LOG_CHUNK_BLOCKS: z.coerce.number().int().min(1).max(10_000).default(200),
  // At most this many eth_getLogs calls per request on the fallback path; the rest waits for the
  // next request (progress is persisted).
  ONCHAIN_MAX_CHUNKS_PER_REQUEST: z.coerce.number().int().min(1).max(1_000).default(10),
  // The events table stops this many blocks short of the head (reorg margin).
  ONCHAIN_CONFIRMATIONS: z.coerce.number().int().min(0).max(1_000).default(10),

  // Sent by the web app's server-rendered pages as `x-paytag-server-key`: they all come from
  // Vercel's shared addresses, so they skip the per-address limit on the public reads.
  API_SERVER_KEY: z.string().min(32, 'API_SERVER_KEY must be at least 32 characters').optional(),

  // Set to the value Cloudflare's Transform Rule sends as `x-paytag-edge`. When set, requests
  // without it (anything reaching the Fly origin directly) are refused, except /health, and the
  // rate limit keys on CF-Connecting-IP. Unset (local dev): no check.
  EDGE_SECRET: z.string().min(32, 'EDGE_SECRET must be at least 32 characters').optional(),

  // Requests per minute per client IP on /auth/nonce, /auth/verify and /register (one budget).
  AUTH_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(20),

  // Requests per minute per client IP on the public reads (/resolve, /available).
  PUBLIC_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(120),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;

/** Longest token lifetime the API issues, whatever JWT_EXPIRES_IN says. */
export const MAX_TOKEN_SECONDS = 24 * 60 * 60;

/**
 * JWT_EXPIRES_IN as seconds: a bare number of seconds or <n>s|m|h|d. Anything longer than
 * MAX_TOKEN_SECONDS is capped (with a warning) rather than refused, so a stale long value in the
 * deploy environment can't stretch tokens and can't take the API down either. Unparseable or
 * zero values stop the boot.
 */
export const jwtExpiresInSeconds: number = (() => {
  const raw = env.JWT_EXPIRES_IN.trim();
  const match = /^(\d+)([smhd]?)$/.exec(raw);
  const unit: Record<string, number> = { '': 1, s: 1, m: 60, h: 3600, d: 86400 };
  const seconds = match ? Number(match[1]) * unit[match[2]] : NaN;
  if (!Number.isSafeInteger(seconds) || seconds <= 0) {
    // eslint-disable-next-line no-console
    console.error(`Invalid JWT_EXPIRES_IN "${raw}": use seconds or <n>s|m|h|d, e.g. "24h"`);
    process.exit(1);
  }
  if (seconds > MAX_TOKEN_SECONDS) {
    // eslint-disable-next-line no-console
    console.warn(`JWT_EXPIRES_IN "${raw}" is longer than 24h; tokens are capped at 24h`);
    return MAX_TOKEN_SECONDS;
  }
  return seconds;
})();

const DOMAIN_PATTERN = /^[a-z0-9.-]+(:\d{1,5})?$/;

/**
 * The SIWE domain allowlist. Outside production it defaults to the local web app. In production an
 * empty list would refuse every sign-in, so the process refuses to start instead.
 */
export const siweDomains: readonly string[] = (() => {
  const configured = (env.SIWE_DOMAINS ?? '')
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
  const invalid = configured.filter((d) => !DOMAIN_PATTERN.test(d));
  if (invalid.length > 0) {
    // eslint-disable-next-line no-console
    console.error('Invalid SIWE_DOMAINS entries (host[:port] only):', invalid);
    process.exit(1);
  }
  if (configured.length > 0) return configured;
  if (env.NODE_ENV === 'production') {
    // eslint-disable-next-line no-console
    console.error('SIWE_DOMAINS must be set in production (e.g. "www.paytag.dev,paytag.dev")');
    process.exit(1);
  }
  return ['localhost:3002', 'localhost:3000'];
})();
export type Env = typeof env;
