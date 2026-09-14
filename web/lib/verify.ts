'use client';

import { useAccount, useSignMessage } from 'wagmi';
import type { PaytagChain } from './chains';
import { shortAddress } from './format';

/** A verification problem with a message that's safe to show as-is. */
export class VerifyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VerifyError';
  }
}

/** Bitcoin message signing (BIP-322) isn't verified server-side yet. */
export const canVerifyChain = (chain: PaytagChain): boolean => chain !== 'bitcoin';

// Minimal Phantom surface for message signing. Read straight off window so the
// dashboard doesn't pull in @solana/web3.js.
interface PhantomMessageSigner {
  isPhantom?: boolean;
  isConnected: boolean;
  publicKey: { toString(): string } | null;
  connect(): Promise<{ publicKey: { toString(): string } }>;
  signMessage(message: Uint8Array, display?: 'utf8' | 'hex'): Promise<{ signature: Uint8Array }>;
}

const getPhantomSigner = (): PhantomMessageSigner | null => {
  const candidate = (window.phantom?.solana ?? window.solana) as unknown as PhantomMessageSigner | undefined;
  return candidate?.isPhantom ? candidate : null;
};

const toBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
};

/** EIP-1193 4100: the account isn't one this site may use. */
const isUnauthorizedAccount = (err: unknown): boolean => {
  let current: unknown = err;
  for (let depth = 0; current && typeof current === 'object' && depth < 5; depth += 1) {
    const e = current as { code?: unknown; message?: unknown; cause?: unknown };
    if (e.code === 4100) return true;
    if (typeof e.message === 'string' && /not been authorized|unauthorized|unknown account/i.test(e.message)) {
      return true;
    }
    current = e.cause;
  }
  return false;
};

/**
 * Returns `sign(chain, address, message)` that asks the matching wallet to sign
 * the server's verification message with the key for `address`.
 */
export function useAddressSigner() {
  const { address: connected } = useAccount();
  const { signMessageAsync } = useSignMessage();

  return async (chain: PaytagChain, target: string, message: string): Promise<string> => {
    if (chain === 'ethereum') {
      if (!connected) throw new VerifyError('Connect your wallet to verify this address.');
      // The mapped address needn't be the selected account — only one the
      // wallet lets this site use. Switching accounts would sign you out.
      try {
        return await signMessageAsync({ account: target as `0x${string}`, message });
      } catch (err) {
        if (isUnauthorizedAccount(err)) {
          throw new VerifyError(
            `Your wallet hasn’t shared ${shortAddress(target)} with Paytag. Connect that account to this site in your wallet, then try again.`,
          );
        }
        throw err;
      }
    }

    if (chain === 'solana') {
      const phantom = getPhantomSigner();
      if (!phantom) throw new VerifyError('Phantom isn’t installed in this browser.');
      const key =
        phantom.isConnected && phantom.publicKey
          ? phantom.publicKey.toString()
          : (await phantom.connect()).publicKey.toString();
      if (key !== target) {
        throw new VerifyError(
          `Phantom is on ${shortAddress(key, 4, 4)}. Switch to ${shortAddress(target, 4, 4)} in Phantom, then try again.`,
        );
      }
      const { signature } = await phantom.signMessage(new TextEncoder().encode(message), 'utf8');
      return toBase64(signature);
    }

    throw new VerifyError('Bitcoin verification is coming soon.');
  };
}
