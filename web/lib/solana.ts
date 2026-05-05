import {
  clusterApiUrl,
  Connection,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from '@solana/web3.js';
import { SOLANA_NETWORKS, SolanaNetwork } from './chains';

interface PhantomProvider {
  isPhantom?: boolean;
  publicKey: { toString(): string } | null;
  isConnected: boolean;
  connect(): Promise<{ publicKey: { toString(): string } }>;
  disconnect(): Promise<void>;
  signAndSendTransaction(tx: Transaction): Promise<{ signature: string }>;
  on(event: 'connect' | 'disconnect' | 'accountChanged', cb: (...args: unknown[]) => void): void;
  removeListener?(event: string, cb: (...args: unknown[]) => void): void;
}

declare global {
  interface Window {
    solana?: PhantomProvider;
    phantom?: { solana?: PhantomProvider };
  }
}

export class SolanaSendError extends Error {
  constructor(
    public code:
      | 'NO_PHANTOM'
      | 'INVALID_RECIPIENT'
      | 'INVALID_AMOUNT'
      | 'CONNECT_REJECTED'
      | 'SEND_REJECTED'
      | 'CONFIRM_FAILED'
      | 'NETWORK_ERROR',
    message: string,
  ) {
    super(message);
    this.name = 'SolanaSendError';
  }
}

export const getPhantom = (): PhantomProvider | null => {
  if (typeof window === 'undefined') return null;
  // Newer Phantom releases expose under window.phantom.solana; older under window.solana.
  const candidate = window.phantom?.solana ?? window.solana;
  return candidate?.isPhantom ? candidate : null;
};

export const connectPhantom = async (): Promise<string> => {
  const phantom = getPhantom();
  if (!phantom) {
    throw new SolanaSendError(
      'NO_PHANTOM',
      'Phantom wallet not detected. Install it from phantom.app.',
    );
  }
  try {
    const { publicKey } = await phantom.connect();
    return publicKey.toString();
  } catch (err) {
    throw new SolanaSendError(
      'CONNECT_REJECTED',
      (err as Error)?.message ?? 'Connection rejected',
    );
  }
};

export const getConnection = (network: SolanaNetwork): Connection =>
  new Connection(clusterApiUrl(SOLANA_NETWORKS[network].cluster), 'confirmed');

interface SendSolArgs {
  fromPubkey: string;
  toAddress: string;
  sol: number;
  network: SolanaNetwork;
}

export const sendSol = async ({
  fromPubkey,
  toAddress,
  sol,
  network,
}: SendSolArgs): Promise<{ signature: string }> => {
  const phantom = getPhantom();
  if (!phantom) {
    throw new SolanaSendError('NO_PHANTOM', 'Phantom wallet not detected.');
  }
  if (!Number.isFinite(sol) || sol <= 0) {
    throw new SolanaSendError('INVALID_AMOUNT', 'Amount must be greater than zero.');
  }

  let from: PublicKey;
  let to: PublicKey;
  try {
    from = new PublicKey(fromPubkey);
  } catch {
    throw new SolanaSendError('INVALID_RECIPIENT', 'Invalid sender public key.');
  }
  try {
    to = new PublicKey(toAddress);
  } catch {
    throw new SolanaSendError(
      'INVALID_RECIPIENT',
      'Recipient address is not a valid Solana address.',
    );
  }

  const lamports = Math.round(sol * LAMPORTS_PER_SOL);
  if (lamports <= 0) {
    throw new SolanaSendError('INVALID_AMOUNT', 'Amount is too small to send.');
  }

  const connection = getConnection(network);
  let blockhash: string;
  try {
    ({ blockhash } = await connection.getLatestBlockhash('confirmed'));
  } catch (err) {
    throw new SolanaSendError(
      'NETWORK_ERROR',
      `Failed to fetch recent blockhash: ${(err as Error)?.message ?? 'unknown'}`,
    );
  }

  const tx = new Transaction({ feePayer: from, recentBlockhash: blockhash }).add(
    SystemProgram.transfer({ fromPubkey: from, toPubkey: to, lamports }),
  );

  try {
    const { signature } = await phantom.signAndSendTransaction(tx);
    return { signature };
  } catch (err) {
    throw new SolanaSendError(
      'SEND_REJECTED',
      (err as Error)?.message ?? 'Transaction rejected',
    );
  }
};

export const confirmTransaction = async (
  signature: string,
  network: SolanaNetwork,
): Promise<void> => {
  const connection = getConnection(network);
  try {
    const result = await connection.confirmTransaction(signature, 'confirmed');
    if (result.value.err) {
      throw new SolanaSendError(
        'CONFIRM_FAILED',
        `Transaction failed on-chain: ${JSON.stringify(result.value.err)}`,
      );
    }
  } catch (err) {
    if (err instanceof SolanaSendError) throw err;
    throw new SolanaSendError(
      'CONFIRM_FAILED',
      (err as Error)?.message ?? 'Confirmation failed',
    );
  }
};
