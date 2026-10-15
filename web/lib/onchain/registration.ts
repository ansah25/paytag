import { bytesToHex, encodeAbiParameters, keccak256, stringToBytes, type Address, type Hex } from 'viem';

// Two-step registration (PaytagRegistry v0.2): commit to (name, owner, secret), wait, reveal.
// Pure helpers plus a small localStorage cache for the secret, so a page refresh during the
// wait doesn't lose the reservation. Losing it is harmless: the user just reserves again.

/** Mirrors PaytagRegistry.MIN_COMMITMENT_AGE / MAX_COMMITMENT_AGE (seconds). */
export const MIN_COMMITMENT_AGE = 15;
export const MAX_COMMITMENT_AGE = 24 * 60 * 60;

export interface Reservation {
  name: string; // normalized
  owner: string; // lowercase
  secret: Hex;
  commitment: Hex;
}

/** 32 random bytes from the browser's CSPRNG. */
export function makeSecret(): Hex {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

/** Same hash as PaytagRegistry.makeCommitment: keccak256(abi.encode(node, owner, secret)). `name` must be normalized. */
export function commitmentFor(name: string, owner: Address, secret: Hex): Hex {
  const node = keccak256(stringToBytes(name));
  return keccak256(
    encodeAbiParameters([{ type: 'bytes32' }, { type: 'address' }, { type: 'bytes32' }], [node, owner, secret]),
  );
}

export type ReservationPhase =
  | { kind: 'missing' } // never landed, already used, or made from another wallet
  | { kind: 'waiting'; revealableAt: number }
  | { kind: 'ready'; expiresAt: number }
  | { kind: 'expired' };

/** Where a commitment stands, from its on-chain time (0 = none) and the chain's current time. */
export function reservationPhase(committedAt: number, chainNow: number): ReservationPhase {
  if (committedAt <= 0) return { kind: 'missing' };
  const revealableAt = committedAt + MIN_COMMITMENT_AGE;
  const expiresAt = committedAt + MAX_COMMITMENT_AGE;
  if (chainNow < revealableAt) return { kind: 'waiting', revealableAt };
  if (chainNow > expiresAt) return { kind: 'expired' };
  return { kind: 'ready', expiresAt };
}

const key = (owner: string, name: string) => `paytag:reservation:${owner.toLowerCase()}:${name}`;

export function saveReservation(r: Reservation): void {
  try {
    localStorage.setItem(key(r.owner, r.name), JSON.stringify(r));
  } catch {
    // private mode or blocked storage: the reservation still works until a refresh
  }
}

export function loadReservation(owner: string, name: string): Reservation | null {
  try {
    const raw = localStorage.getItem(key(owner, name));
    if (!raw) return null;
    const r = JSON.parse(raw) as Reservation;
    return r && r.name === name && r.owner === owner.toLowerCase() && /^0x[0-9a-f]{64}$/i.test(r.secret) ? r : null;
  } catch {
    return null;
  }
}

export function clearReservation(owner: string, name: string): void {
  try {
    localStorage.removeItem(key(owner, name));
  } catch {
    // nothing to clear
  }
}
