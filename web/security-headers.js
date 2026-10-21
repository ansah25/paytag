// @ts-check
// Security headers for every route (wired in next.config.js). Plain CommonJS because Next 14 loads
// next.config.js without TypeScript; the origins come from lib/endpoints.json, the same file the
// app's fetches use (lib/endpoints.ts), so the two can't drift.
const endpoints = require('./lib/endpoints.json');

// Enforced. It ran report-only first (PR #24) and real use produced no reports. Violations still
// go to /api/csp-report (Vercel logs), so a missed origin shows up there as well as breaking. To
// roll back, set this to false: the policy goes back to report-only and nothing is blocked.
// X-Frame-Options below stays either way, for browsers that ignore frame-ancestors.
const CSP_ENFORCE = true;

const CSP_REPORT_PATH = '/api/csp-report';

/**
 * @param {string} url
 * @param {string} [name] env var the value came from, for the error message
 */
const originOf = (url, name) => {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    parsed = null;
  }
  // `localhost:3000` parses as scheme "localhost:" with origin "null", so check the scheme too.
  if (!parsed || (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')) {
    throw new Error(`security-headers: ${name ?? 'endpoint'} is not an http(s) URL: ${JSON.stringify(url)}`);
  }
  return parsed.origin;
};

/** @param {Record<string, string | undefined>} env @param {string} name @param {string} fallback */
const envOrigin = (env, name, fallback) => (env[name] ? originOf(env[name], name) : originOf(fallback));

/**
 * script-src keeps 'unsafe-inline': the App Router inlines its RSC payload and we inline the theme
 * script, and the alternative (per-request nonces) makes every page dynamic, including the pay
 * pages. That trade holds while there's no HTML injection sink: React escapes all text, and the
 * only dangerouslySetInnerHTML is our own constant. If user content (bio, display name) ever
 * renders as markdown or rich text, that sink exists and nonces become worth the cost.
 *
 * Wallets: only wagmi's injected connector, Phantom and Sats Connect are used; they talk to
 * extensions in-page, not over the network. Adding WalletConnect, Coinbase Wallet SDK or a connect
 * modal needs their relay/API origins in connect-src, frame-src and img-src.
 *
 * @param {Record<string, string | undefined>} env
 */
function buildCsp(env) {
  const dev = env.NODE_ENV === 'development';
  const preview = env.VERCEL_ENV === 'preview';

  const solana = Object.values(endpoints.solanaRpc).map(originOf);
  const connect = [
    "'self'",
    envOrigin(env, 'NEXT_PUBLIC_API_BASE_URL', endpoints.apiDefault),
    envOrigin(env, 'NEXT_PUBLIC_INDEXER_URL', endpoints.indexerDefault),
    originOf(endpoints.evmRpc.mainnet),
    originOf(endpoints.evmRpc.sepolia),
    envOrigin(env, 'NEXT_PUBLIC_BASE_SEPOLIA_RPC', endpoints.evmRpc.baseSepolia),
    ...solana,
    // @solana/web3.js confirms transactions over a websocket on the RPC host.
    ...solana.map((o) => o.replace(/^https:/, 'wss:')),
    ...Object.values(endpoints.mempoolApi).map(originOf),
    originOf(endpoints.pricesUrl),
  ];
  const script = ["'self'", "'unsafe-inline'"];
  const style = ["'self'", "'unsafe-inline'"];
  const img = ["'self'", 'data:', 'blob:'];
  const font = ["'self'"];
  const frame = ["'none'"];

  // React's dev overlay and webpack HMR evaluate code; production never does.
  if (dev) script.push("'unsafe-eval'");
  // Vercel's preview toolbar (comments, feedback). Kept off production on purpose: Vercel's prod
  // runtime still injects it for anyone with the __vercel_toolbar=1 cookie (team members only), and
  // there it's blocked and logs a [csp] report per page view. Ignore those, or clear the cookie.
  if (preview) {
    script.push('https://vercel.live');
    style.push('https://vercel.live');
    connect.push('https://vercel.live', 'wss://ws-us3.pusher.com');
    img.push('https://vercel.live', 'https://vercel.com');
    font.push('https://vercel.live', 'https://assets.vercel.com');
    frame.splice(0, 1, 'https://vercel.live');
  }

  const directives = [
    "default-src 'self'",
    `script-src ${script.join(' ')}`,
    `style-src ${style.join(' ')}`,
    `img-src ${img.join(' ')}`,
    `font-src ${font.join(' ')}`,
    `connect-src ${[...new Set(connect)].join(' ')}`,
    `frame-src ${frame.join(' ')}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    // Local dev runs on plain http; upgrading would break it. Browsers ignore (and warn about) it
    // in a report-only policy, so it's only sent when enforced.
    ...(dev || !CSP_ENFORCE ? [] : ['upgrade-insecure-requests']),
    `report-uri ${CSP_REPORT_PATH}`,
  ];
  return directives.join('; ');
}

/** @param {Record<string, string | undefined>} env */
function securityHeaders(env) {
  return [
    { key: CSP_ENFORCE ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only', value: buildCsp(env) },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    // Only features the app has no use for. hid/usb stay allowed for hardware wallets (Ledger).
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  ];
}

module.exports = { securityHeaders, buildCsp, CSP_REPORT_PATH, CSP_ENFORCE };
