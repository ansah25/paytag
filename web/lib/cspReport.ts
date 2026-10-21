// Parsing for /api/csp-report. Browsers POST a violation report whenever the Content-Security-Policy
// blocks something (or would, if it's switched back to report-only); these become one log line
// each in Vercel's logs.

/** Bigger than any real report; anything past it is dropped unread. */
export const MAX_REPORT_BYTES = 8 * 1024;

export interface CspViolation {
  directive: string;
  blocked: string;
  page: string;
  source?: string;
}

const clip = (v: unknown, max = 300): string => (typeof v === 'string' ? v.slice(0, max) : '');

// Browser extensions inject scripts and styles into every page; their violations aren't ours to fix.
const EXTENSION = /^(chrome|moz|safari-web|ms-browser)-extension:/;

/** Accepts the legacy `report-uri` shape ({"csp-report": {...}}) and the Reporting API array. */
export function parseCspReport(body: string): CspViolation[] {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return [];
  }
  const raw: Record<string, unknown>[] = [];
  if (Array.isArray(json)) {
    for (const r of json) {
      if (r && typeof r === 'object' && r.type === 'csp-violation' && r.body && typeof r.body === 'object') raw.push(r.body);
    }
  } else if (json && typeof json === 'object' && 'csp-report' in json) {
    const r = (json as Record<string, unknown>)['csp-report'];
    if (r && typeof r === 'object') raw.push(r as Record<string, unknown>);
  }

  return raw
    .map((r) => {
      const v: CspViolation = {
        directive: clip(r['effective-directive'] ?? r['violated-directive'] ?? r.effectiveDirective, 80),
        blocked: clip(r['blocked-uri'] ?? r.blockedURL),
        page: clip(r['document-uri'] ?? r.documentURL),
      };
      const file = clip(r['source-file'] ?? r.sourceFile);
      if (file) v.source = file;
      return v;
    })
    .filter((v) => v.directive && !EXTENSION.test(v.blocked) && !EXTENSION.test(v.source ?? ''));
}
