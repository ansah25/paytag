import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

// The CSP's connect-src is built from lib/endpoints.json. That only holds if every browser request
// takes its URL from lib/endpoints.ts, so: no hard-coded URLs in network calls, and no bare
// `http()` transport (which would fall back to viem's chain default, off the CSP).

const WEB = join(__dirname, '..');
const CALL = /\b(fetch|http|new Connection|new WebSocket|new EventSource)\(\s*([^,)\s]*)/g;

// Server-only calls: the CSP doesn't apply to them.
const SERVER_ONLY = new Set(['lib/status.ts:https://registry.npmjs.org']);

function* sources(dir: string): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* sources(p);
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) yield p;
  }
}

describe('network calls take their URL from lib/endpoints.ts', () => {
  const offenders: string[] = [];
  for (const dir of ['app', 'components', 'lib']) {
    for (const file of sources(join(WEB, dir))) {
      const rel = relative(WEB, file).split(sep).join('/');
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(CALL)) {
        const arg = m[2];
        const literal = /^['"`](https?|wss?):\/\/[^/'"`$]+/.exec(arg)?.[0].slice(1);
        if (literal && !SERVER_ONLY.has(`${rel}:${literal}`)) offenders.push(`${rel}: ${m[0]}`);
        if (m[1] === 'http' && arg === '' && rel === 'lib/wagmi.ts') offenders.push(`${rel}: bare http()`);
      }
    }
  }

  it('finds no hard-coded origins or default transports', () => {
    expect(offenders).toEqual([]);
  });
});
