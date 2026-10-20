import { MAX_REPORT_BYTES, parseCspReport } from '@/lib/cspReport';

// Collects Content-Security-Policy violation reports (see web/security-headers.js) into the logs.
export async function POST(req: Request): Promise<Response> {
  const length = Number(req.headers.get('content-length') ?? 0);
  if (length > MAX_REPORT_BYTES) return new Response(null, { status: 413 });

  const body = await req.text();
  if (body.length > MAX_REPORT_BYTES) return new Response(null, { status: 413 });

  for (const v of parseCspReport(body)) console.warn('[csp]', JSON.stringify(v));
  return new Response(null, { status: 204 });
}
