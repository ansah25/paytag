import { MAX_REPORT_BYTES, parseCspReport } from '@/lib/cspReport';

// Collects Content-Security-Policy violation reports (see web/security-headers.js) into the logs.
export async function POST(req: Request): Promise<Response> {
  const body = await readCapped(req, MAX_REPORT_BYTES);
  if (body === null) return new Response(null, { status: 413 });

  for (const v of parseCspReport(body)) console.warn('[csp]', JSON.stringify(v));
  return new Response(null, { status: 204 });
}

/** Reads at most `max` bytes, counting as it streams; null (and the stream cancelled) past that. */
async function readCapped(req: Request, max: number): Promise<string | null> {
  if (Number(req.headers.get('content-length')) > max) return null;
  if (!req.body) return '';
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}
