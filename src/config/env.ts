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

  // On-chain registry indexer (e.g. https://indexer.paytag.dev). Unset: every on-chain
  // lookup reports `unavailable` and nothing is gated on it.
  INDEXER_URL: z.string().url().optional(),
  // This API's own key from the indexer's INDEXER_SERVER_KEYS, so its lookups aren't limited
  // per address. Server-side only.
  INDEXER_SERVER_KEY: z.string().min(1).optional(),

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
