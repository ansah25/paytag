import { decodeErrorResult, hexToString, type Abi, type Hex } from 'viem';
import { PaytagRegistryAbi } from './generated/PaytagRegistryAbi';
import { PaytagResolverAbi } from './generated/PaytagResolverAbi';

// Turns anything thrown by simulate/write/receipt into one readable sentence. The contracts
// revert with custom errors (see contracts/src), which viem decodes into
// ContractFunctionRevertedError { data: { errorName, args } } somewhere down the `cause` chain.

export type TxErrorKind = 'rejected' | 'revert' | 'funds' | 'network' | 'unknown';

export interface TxError {
  kind: TxErrorKind;
  message: string;
  /** Contract error name when kind === 'revert', for tests and analytics. */
  errorName?: string;
}

export interface ErrorContext {
  /** Normalized name the action is about, used to make messages specific. */
  name?: string;
}

type ErrorLike = {
  name?: unknown;
  code?: unknown;
  shortMessage?: unknown;
  message?: unknown;
  cause?: unknown;
  data?: unknown;
};

type RevertedData = { errorName?: unknown; args?: unknown };

const CONTRACT_ERRORS = [...PaytagRegistryAbi, ...PaytagResolverAbi].filter((item) => item.type === 'error') as Abi;

const isRevertHex = (v: unknown): v is Hex => typeof v === 'string' && /^0x[0-9a-fA-F]{8,}$/.test(v);

/**
 * Raw revert data some wallets nest inside a generic "Internal JSON-RPC error" instead of letting
 * viem decode it: `data`, `data.data`, or MetaMask's `data.originalError.data`.
 */
function rawRevertData(e: ErrorLike): Hex | null {
  const d = e.data as { data?: unknown; originalError?: { data?: unknown } } | unknown;
  if (isRevertHex(d)) return d;
  if (d && typeof d === 'object') {
    const nested = d as { data?: unknown; originalError?: { data?: unknown } };
    if (isRevertHex(nested.data)) return nested.data;
    if (isRevertHex(nested.originalError?.data)) return nested.originalError.data;
  }
  return null;
}

const MAX_FALLBACK = 160;

function chainOf(err: unknown): ErrorLike[] {
  const out: ErrorLike[] = [];
  let current: unknown = err;
  for (let depth = 0; current && typeof current === 'object' && depth < 8; depth += 1) {
    out.push(current as ErrorLike);
    current = (current as ErrorLike).cause;
  }
  return out;
}

function charFromBytes1(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('0x')) return '?';
  const code = parseInt(value.slice(2, 4), 16);
  if (code === 0x20) return 'space';
  if (code < 0x20 || code === 0x7f) return `0x${value.slice(2, 4)}`;
  try {
    return hexToString(value as Hex).replace(/\0/g, '') || '?';
  } catch {
    return '?';
  }
}

/** Readable sentence for a decoded PaytagRegistry / PaytagResolver custom error. */
export function revertMessage(errorName: string, args: readonly unknown[], ctx: ErrorContext = {}): string {
  const at = ctx.name ? `@${ctx.name}` : 'This name';
  switch (errorName) {
    case 'InvalidLength':
      return `Names must be 3–20 characters (this one is ${String(args[0])}).`;
    case 'InvalidCharacter': {
      const index = Number(args[0]);
      return `Character ${index + 1} (${charFromBytes1(args[1])}) isn’t allowed. Use a–z, 0–9 and _.`;
    }
    case 'NonAsciiName':
      return `Character ${Number(args[0]) + 1} isn’t plain ASCII. Lookalike letters from other alphabets are blocked.`;
    case 'NameTaken':
      return `${at} is already registered.`;
    case 'ReservedName':
      return `${at} is reserved and can’t be registered.`;
    case 'NotOwner':
      return `Only the owner of ${at === 'This name' ? 'this name' : at} can do that. Is the right wallet connected?`;
    case 'ZeroAddress':
      return 'Can’t transfer to the zero address.';
    case 'InvalidEthAddress':
      return `An Ethereum record must be exactly 20 bytes (got ${String(args[0])}).`;
    case 'ZeroEthAddress':
      return 'The zero address can’t be used as an Ethereum record. Clear the record instead.';
    case 'CommitmentNotFound':
      // The owner is bound into the commitment, so a reveal from another wallet lands here too.
      return `No reservation for ${at === 'This name' ? 'this name' : at} from this wallet. Reservations only work from the wallet that made them; reserve again from this one.`;
    case 'CommitmentTooNew': {
      const readyAt = Number(args[1]);
      const wait = Number.isFinite(readyAt) ? Math.max(1, Math.ceil(readyAt - Date.now() / 1000)) : null;
      return wait ? `Your reservation isn’t ready yet. Try again in about ${wait}s.` : 'Your reservation isn’t ready yet. Try again in a few seconds.';
    }
    case 'CommitmentTooOld':
      return 'Your reservation expired (they last 24 hours). Reserve the name again.';
    case 'ReverseMismatch':
      return `${at}’s Ethereum record must point at your connected wallet before it can be your primary name.`;
    default:
      return `The contract rejected this (${errorName}).`;
  }
}

export function decodeTxError(err: unknown, ctx: ErrorContext = {}): TxError {
  const chain = chainOf(err);
  const names = chain.map((e) => e.name);
  const text = chain
    .map((e) => `${typeof e.shortMessage === 'string' ? e.shortMessage : ''} ${typeof e.message === 'string' ? e.message : ''}`)
    .join(' ');

  if (
    names.includes('UserRejectedRequestError') ||
    chain.some((e) => e.code === 4001) ||
    /user rejected|rejected the request|user denied|user cancel/i.test(text)
  ) {
    return { kind: 'rejected', message: 'Rejected in your wallet.' };
  }

  const reverted = chain.find(
    (e) => e.name === 'ContractFunctionRevertedError' && typeof (e.data as RevertedData | undefined)?.errorName === 'string',
  );
  if (reverted) {
    const data = reverted.data as RevertedData;
    const args = Array.isArray(data.args) ? data.args : [];
    return { kind: 'revert', errorName: data.errorName as string, message: revertMessage(data.errorName as string, args, ctx) };
  }

  // Fallback: decode raw revert bytes against both contracts' custom errors.
  for (const e of chain) {
    const raw = rawRevertData(e);
    if (!raw) continue;
    try {
      const decoded = decodeErrorResult({ abi: CONTRACT_ERRORS, data: raw });
      return { kind: 'revert', errorName: decoded.errorName, message: revertMessage(decoded.errorName, decoded.args ?? [], ctx) };
    } catch {
      // not one of ours; keep looking
    }
  }

  if (names.includes('InsufficientFundsError') || /insufficient funds/i.test(text)) {
    return { kind: 'funds', message: 'Not enough Base Sepolia ETH to pay for gas.' };
  }

  if (names.includes('ChainMismatchError') || /chain mismatch|does not match the target chain/i.test(text)) {
    return { kind: 'network', message: 'Switch your wallet to Base Sepolia and try again.' };
  }

  const top = chain[0];
  const readable =
    (typeof top?.shortMessage === 'string' && top.shortMessage) || (typeof top?.message === 'string' && top.message) || '';
  return {
    kind: 'unknown',
    message: readable && readable.length <= MAX_FALLBACK ? readable : 'Something went wrong sending the transaction.',
  };
}
