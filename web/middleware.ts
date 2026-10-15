import { NextResponse, type NextRequest } from 'next/server';
import { isInvalidOnchainSegment } from '@/lib/onchain/routing';

// /on-chain/<name> pages stream behind the root loading.tsx, so by the time the page calls
// notFound() the 200 status has already been sent. Invalid names are knowable from the URL alone,
// so give them a real 404 here, before streaming starts.
export function middleware(req: NextRequest) {
  const segment = req.nextUrl.pathname.split('/')[2];
  if (!segment || !isInvalidOnchainSegment(segment)) return NextResponse.next();
  // Same URL, so the page still renders (its notFound() shows the not-found screen); only the
  // status changes. Rewrites don't re-enter middleware.
  return NextResponse.rewrite(req.nextUrl, { status: 404 });
}

// The explicit pattern matters: Next appends `(.json)?` to every matcher, and a bare trailing
// `:segment` would take that as its own pattern and match nothing but `/on-chain/.json`.
export const config = { matcher: '/on-chain/:segment([^/]+)' };
