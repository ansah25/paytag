import { normalizeName } from './generated/names';

// Static sub-routes of /on-chain contain a hyphen, which no name can, so they never shadow a
// name's page (and are never mistaken for an invalid one).
const STATIC_ONCHAIN = new Set(['my-names']);

/** True when /on-chain/<segment> can't be a name's page: answer it with a 404 up front. */
export function isInvalidOnchainSegment(segment: string): boolean {
  if (STATIC_ONCHAIN.has(segment)) return false;
  let raw: string;
  try {
    raw = decodeURIComponent(segment);
  } catch {
    return true; // malformed escape: certainly not a valid name
  }
  return !normalizeName(raw).ok;
}
