import { describe, expect, it } from 'vitest';
import * as endpoints from './endpoints';
import { buildCsp, securityHeaders } from '../security-headers';

const prod = { NODE_ENV: 'production' };

const directive = (csp: string, name: string): string[] => {
  const d = csp.split('; ').find((p) => p.startsWith(`${name} `));
  return d ? d.split(' ').slice(1) : [];
};

describe('securityHeaders', () => {
  it('sends the CSP plus the static headers', () => {
    const keys = securityHeaders(prod).map((h) => h.key);
    expect(keys).toEqual(
      expect.arrayContaining(['X-Frame-Options', 'X-Content-Type-Options', 'Referrer-Policy', 'Permissions-Policy']),
    );
    expect(keys.some((k) => k.startsWith('Content-Security-Policy'))).toBe(true);
    expect(securityHeaders(prod).find((h) => h.key === 'X-Frame-Options')?.value).toBe('DENY');
  });

  it('leaves hid and usb alone for hardware wallets', () => {
    const pp = securityHeaders(prod).find((h) => h.key === 'Permissions-Policy')!.value;
    expect(pp).not.toMatch(/hid|usb/);
  });
});

describe('buildCsp', () => {
  it('refuses framing, plugins and base/form hijacking', () => {
    const csp = buildCsp(prod);
    expect(directive(csp, 'frame-ancestors')).toEqual(["'none'"]);
    expect(directive(csp, 'object-src')).toEqual(["'none'"]);
    expect(directive(csp, 'base-uri')).toEqual(["'self'"]);
    expect(directive(csp, 'form-action')).toEqual(["'self'"]);
    expect(directive(csp, 'report-uri')).toEqual(['/api/csp-report']);
  });

  it('never allows eval outside development', () => {
    expect(buildCsp(prod)).not.toContain('unsafe-eval');
    expect(buildCsp({ NODE_ENV: 'production', VERCEL_ENV: 'preview' })).not.toContain('unsafe-eval');
    expect(directive(buildCsp({ NODE_ENV: 'development' }), 'script-src')).toContain("'unsafe-eval'");
  });

  it('allows every origin the app fetches (lib/endpoints.ts)', () => {
    const connect = directive(buildCsp({ ...prod, ...process.env }), 'connect-src');
    const urls = [
      endpoints.API_URL,
      endpoints.INDEXER_URL,
      ...Object.values(endpoints.EVM_RPC),
      ...Object.values(endpoints.SOLANA_RPC),
      ...Object.values(endpoints.MEMPOOL_API),
      endpoints.PRICES_URL,
    ];
    for (const url of urls) expect(connect).toContain(new URL(url).origin);
    for (const url of Object.values(endpoints.SOLANA_RPC)) expect(connect).toContain(new URL(url).origin.replace('https:', 'wss:'));
  });

  it('follows the API, indexer and RPC env overrides', () => {
    const connect = directive(
      buildCsp({
        ...prod,
        NEXT_PUBLIC_API_BASE_URL: 'https://api.paytag.dev/',
        NEXT_PUBLIC_INDEXER_URL: 'https://indexer.example.org',
        NEXT_PUBLIC_BASE_SEPOLIA_RPC: 'https://base-sepolia.g.alchemy.com/v2/secretkey',
      }),
      'connect-src',
    );
    expect(connect).toEqual(
      expect.arrayContaining(['https://api.paytag.dev', 'https://indexer.example.org', 'https://base-sepolia.g.alchemy.com']),
    );
    // Origins only: a key in the RPC path must not end up in a response header.
    expect(connect.join(' ')).not.toContain('secretkey');
  });

  it('adds the Vercel toolbar on previews only', () => {
    expect(buildCsp(prod)).not.toContain('vercel.live');
    expect(directive(buildCsp({ ...prod, VERCEL_ENV: 'preview' }), 'script-src')).toContain('https://vercel.live');
  });

  it('upgrades insecure requests except in local development', () => {
    expect(buildCsp(prod)).toContain('upgrade-insecure-requests');
    expect(buildCsp({ NODE_ENV: 'development' })).not.toContain('upgrade-insecure-requests');
  });
});
