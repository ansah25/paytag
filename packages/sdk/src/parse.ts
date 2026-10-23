import { isValidAddress, recordValueFor } from './addresses';
import { PaytagError } from './errors';
import {
  AvailabilityResponse,
  ChainId,
  OnchainLinkStatus,
  OnchainRecord,
  OnchainResolveResponse,
  ResolveResponse,
  SUPPORTED_CHAINS,
  UnavailableReason,
} from './types';

// Response parsing. Nothing from the server is returned as-is: each result is a fresh object
// holding only the fields the SDK knows, every address is checked for its chain, and the
// result is deep-frozen so a caller (or another caller sharing the cache) can't change it.
// An address that fails its check fails the whole response: a server sending one is broken
// or tampered with, and nothing else in that response should be trusted either.

export const USERNAME_REGEX = /^[a-z0-9_]{3,20}$/;

const ONCHAIN_STATUSES: readonly OnchainLinkStatus[] = [
  'linked',
  'not_linked',
  'none',
  'syncing',
  'unavailable',
];
const UNAVAILABLE_REASONS: readonly UnavailableReason[] = [
  'TAKEN',
  'INVALID_FORMAT',
  'RESERVED',
  'TAKEN_ONCHAIN',
];

/** ENSIP-9 / SLIP-44 coin types of the supported chains. */
const COIN_TYPE: Record<ChainId, string> = { ethereum: '60', bitcoin: '0', solana: '501' };

const OWNER_REGEX = /^0x[0-9a-fA-F]{40}$/;
const NODE_REGEX = /^0x[0-9a-fA-F]{64}$/;
const COIN_TYPE_REGEX = /^(0|[1-9][0-9]{0,77})$/; // a uint256 in decimal
const HEX_BYTES_REGEX = /^0x(?:[0-9a-fA-F]{2})*$/;
/** Longest display address kept for a record of another coin type. */
const MAX_RECORD_ADDRESS_LENGTH = 128;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Own, enumerable data only: never a value inherited from Object.prototype. */
const own = (obj: Record<string, unknown>, key: string): unknown =>
  Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined;

const isNonNegativeInteger = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;

const invalid = (message: string): PaytagError => new PaytagError(message, 'INVALID_RESPONSE');

export function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key]);
    Object.freeze(value);
  }
  return value;
}

/** Whether `chain` is a supported chain id (and not, say, "__proto__"). */
export const isChainId = (chain: unknown): chain is ChainId =>
  typeof chain === 'string' && (SUPPORTED_CHAINS as readonly string[]).includes(chain);

/** The supported-chain addresses, each checked; other keys are dropped. */
function parseAddresses(raw: unknown, source: string): Partial<Record<ChainId, string>> {
  if (!isObject(raw)) throw invalid(`Unexpected response shape from ${source}`);
  const addresses: Partial<Record<ChainId, string>> = {};
  for (const chain of SUPPORTED_CHAINS) {
    const address = own(raw, chain);
    if (address === undefined || address === null) continue;
    if (typeof address !== 'string' || !isValidAddress(chain, address)) {
      throw invalid(`${source} returned an invalid ${chain} address`);
    }
    addresses[chain] = address;
  }
  return addresses;
}

function parseUsername(raw: unknown, expected: string, source: string): string {
  if (typeof raw !== 'string') throw invalid(`Unexpected response shape from ${source}`);
  if (raw !== expected) throw invalid(`${source} answered for a different username`);
  return raw;
}

/** A profile field: a string, null (cleared), or absent (older API, or not a string). */
function profileField(raw: Record<string, unknown>, key: string): string | null | undefined {
  const v = own(raw, key);
  return typeof v === 'string' || v === null ? v : undefined;
}

export function parseResolveResponse(body: unknown, expectedUsername: string): ResolveResponse {
  const source = '/resolve';
  if (!isObject(body)) throw invalid(`Unexpected response shape from ${source}`);
  const username = parseUsername(own(body, 'username'), expectedUsername, source);
  const addresses = parseAddresses(own(body, 'addresses'), source);

  const result: {
    -readonly [K in keyof ResolveResponse]: ResolveResponse[K];
  } = { username, addresses };

  // Optional fields: a malformed one is dropped rather than failing the response. Dropping
  // `verified` only ever hides a badge, never shows one that wasn't earned.
  const rawVerified = own(body, 'verified');
  if (isObject(rawVerified)) {
    const verified: Partial<Record<ChainId, boolean>> = {};
    for (const chain of SUPPORTED_CHAINS) {
      if (own(rawVerified, chain) === true && addresses[chain] !== undefined) verified[chain] = true;
    }
    result.verified = verified;
  }
  for (const key of ['displayName', 'bio', 'avatarUrl'] as const) {
    const v = profileField(body, key);
    if (v !== undefined) result[key] = v;
  }
  const rawOnchain = own(body, 'onchain');
  if (isObject(rawOnchain)) {
    const status = own(rawOnchain, 'status');
    if (ONCHAIN_STATUSES.includes(status as OnchainLinkStatus)) {
      result.onchain = { status: status as OnchainLinkStatus };
    }
  }
  return deepFreeze(result);
}

function parseRecord(raw: unknown): OnchainRecord {
  const source = 'indexer /resolve';
  if (!isObject(raw)) throw invalid(`Unexpected record shape from ${source}`);
  const coinType = own(raw, 'coinType');
  const value = own(raw, 'value');
  const address = own(raw, 'address');
  if (
    typeof coinType !== 'string' ||
    !COIN_TYPE_REGEX.test(coinType) ||
    typeof value !== 'string' ||
    !HEX_BYTES_REGEX.test(value) ||
    !(address === null || (typeof address === 'string' && address.length <= MAX_RECORD_ADDRESS_LENGTH))
  ) {
    throw invalid(`Unexpected record shape from ${source}`);
  }
  return { coinType, value, address };
}

export function parseOnchainResolveResponse(
  body: unknown,
  expectedUsername: string,
): OnchainResolveResponse {
  const source = 'indexer /resolve';
  if (!isObject(body)) throw invalid(`Unexpected response shape from ${source}`);
  const username = parseUsername(own(body, 'username'), expectedUsername, source);
  const addresses = parseAddresses(own(body, 'addresses'), source);

  const node = own(body, 'node');
  const owner = own(body, 'owner');
  const registeredAt = own(body, 'registeredAt');
  const epoch = own(body, 'epoch');
  const recordsReset = own(body, 'recordsReset');
  const rawRecords = own(body, 'records');
  if (
    own(body, 'source') !== 'onchain' ||
    typeof node !== 'string' ||
    !NODE_REGEX.test(node) ||
    typeof owner !== 'string' ||
    !OWNER_REGEX.test(owner) ||
    !isNonNegativeInteger(registeredAt) ||
    !isNonNegativeInteger(epoch) ||
    typeof recordsReset !== 'boolean' ||
    !Array.isArray(rawRecords)
  ) {
    throw invalid(`Unexpected response shape from ${source}`);
  }
  const records = rawRecords.map(parseRecord);

  // `addresses` is derived from `records`: each must say exactly what the record bytes say, so
  // a response can't show one address while the chain holds another.
  for (const chain of SUPPORTED_CHAINS) {
    const matching = records.filter((r) => r.coinType === COIN_TYPE[chain]);
    if (matching.length > 1) throw invalid(`${source} returned duplicate ${chain} records`);
    const record = matching[0];
    const address = addresses[chain];
    if (record?.address != null) {
      if (address !== record.address || recordValueFor(chain, address) !== record.value.toLowerCase()) {
        throw invalid(`${source} returned a ${chain} address that doesn't match its record`);
      }
    } else if (address !== undefined) {
      throw invalid(`${source} returned a ${chain} address with no record behind it`);
    }
  }

  return deepFreeze({
    username,
    addresses,
    node,
    owner,
    registeredAt,
    epoch,
    recordsReset,
    records,
    source: 'onchain',
  });
}

export function parseAvailabilityResponse(body: unknown): AvailabilityResponse {
  const available = isObject(body) ? own(body, 'available') : undefined;
  const suggestions = isObject(body) ? own(body, 'suggestions') : undefined;
  if (typeof available !== 'boolean' || !Array.isArray(suggestions)) {
    throw invalid('Unexpected response shape from /available');
  }
  const reason = own(body as Record<string, unknown>, 'reason');
  return deepFreeze({
    available,
    ...(UNAVAILABLE_REASONS.includes(reason as UnavailableReason)
      ? { reason: reason as UnavailableReason }
      : {}),
    // Suggestions are names to offer: keep only ones that are valid usernames.
    suggestions: suggestions.filter(
      (s): s is string => typeof s === 'string' && USERNAME_REGEX.test(s),
    ),
  });
}
