import { describe, expect, it } from 'vitest';
import { parseCspReport } from './cspReport';

describe('parseCspReport', () => {
  it('reads the report-uri shape', () => {
    const body = JSON.stringify({
      'csp-report': {
        'document-uri': 'https://www.paytag.dev/derrick',
        'effective-directive': 'connect-src',
        'blocked-uri': 'https://rpc.example.com',
        'source-file': 'https://www.paytag.dev/_next/static/chunks/1.js',
      },
    });
    expect(parseCspReport(body)).toEqual([
      {
        directive: 'connect-src',
        blocked: 'https://rpc.example.com',
        page: 'https://www.paytag.dev/derrick',
        source: 'https://www.paytag.dev/_next/static/chunks/1.js',
      },
    ]);
  });

  it('reads the Reporting API shape and skips other report types', () => {
    const body = JSON.stringify([
      { type: 'csp-violation', body: { documentURL: 'https://www.paytag.dev/', effectiveDirective: 'img-src', blockedURL: 'https://x.test/a.png' } },
      { type: 'deprecation', body: { id: 'x' } },
    ]);
    expect(parseCspReport(body)).toEqual([{ directive: 'img-src', blocked: 'https://x.test/a.png', page: 'https://www.paytag.dev/' }]);
  });

  it('drops browser-extension noise', () => {
    const body = JSON.stringify({ 'csp-report': { 'effective-directive': 'script-src-elem', 'blocked-uri': 'chrome-extension://abc/inject.js' } });
    expect(parseCspReport(body)).toEqual([]);
  });

  it('ignores junk and clips long fields', () => {
    expect(parseCspReport('not json')).toEqual([]);
    expect(parseCspReport('null')).toEqual([]);
    expect(parseCspReport('{"csp-report": 5}')).toEqual([]);
    const [v] = parseCspReport(JSON.stringify({ 'csp-report': { 'effective-directive': 'img-src', 'blocked-uri': 'a'.repeat(5000) } }));
    expect(v.blocked.length).toBe(300);
  });
});
