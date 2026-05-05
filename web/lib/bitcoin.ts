import { request, AddressPurpose } from 'sats-connect';
import { BitcoinNetwork } from './chains';

export class BitcoinSendError extends Error {
  constructor(
    public code:
      | 'NO_WALLET'
      | 'INVALID_AMOUNT'
      | 'CONNECT_REJECTED'
      | 'SEND_REJECTED'
      | 'INVALID_RESPONSE',
    message: string,
  ) {
    super(message);
    this.name = 'BitcoinSendError';
  }
}

export const SATS_PER_BTC = 100_000_000;

/** Convert a BTC decimal string into integer sats. Throws if input is invalid. */
export const btcToSats = (btc: string): number => {
  const trimmed = btc.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new BitcoinSendError('INVALID_AMOUNT', 'Enter a valid BTC amount.');
  }
  const sats = Math.round(Number(trimmed) * SATS_PER_BTC);
  if (!Number.isFinite(sats) || sats <= 0) {
    throw new BitcoinSendError('INVALID_AMOUNT', 'Amount must be greater than zero.');
  }
  return sats;
};

interface ConnectResult {
  paymentAddress: string;
  walletType: string;
}

const errorMessage = (err: unknown): string => {
  if (err && typeof err === 'object') {
    const e = err as { message?: unknown; error?: { message?: unknown } };
    if (typeof e.message === 'string') return e.message;
    if (e.error && typeof e.error === 'object' && typeof e.error.message === 'string') {
      return e.error.message;
    }
  }
  return 'Unknown error';
};

/**
 * Open the Sats Connect modal so the user picks a wallet (Xverse, Leather, …)
 * and authorizes us to read their Payment-purpose address. The wallet's
 * configured network governs whether mainnet or testnet is used; the app's
 * `network` prop is only used for routing the explorer link.
 */
export const connectBitcoin = async (): Promise<ConnectResult> => {
  let response;
  try {
    response = await request('getAccounts', {
      purposes: [AddressPurpose.Payment],
      message: 'Connect to Paytag to send Bitcoin',
    });
  } catch (err) {
    throw new BitcoinSendError(
      'NO_WALLET',
      `No Bitcoin wallet detected. ${errorMessage(err)}`.trim(),
    );
  }

  if (response.status !== 'success') {
    throw new BitcoinSendError(
      'CONNECT_REJECTED',
      errorMessage(response.error) || 'Connection rejected',
    );
  }

  const payment = response.result.find((a) => a.purpose === AddressPurpose.Payment);
  if (!payment) {
    throw new BitcoinSendError(
      'INVALID_RESPONSE',
      'Wallet did not return a Payment address.',
    );
  }
  return { paymentAddress: payment.address, walletType: payment.walletType };
};

interface SendBtcArgs {
  toAddress: string;
  sats: number;
  /** UI hint only — the wallet's configured network governs the actual broadcast. */
  network?: BitcoinNetwork;
}

export const sendBtc = async ({
  toAddress,
  sats,
}: SendBtcArgs): Promise<{ txid: string }> => {
  if (!Number.isInteger(sats) || sats <= 0) {
    throw new BitcoinSendError('INVALID_AMOUNT', 'Amount must be a positive integer (sats).');
  }

  let response;
  try {
    response = await request('sendTransfer', {
      recipients: [{ address: toAddress, amount: sats }],
    });
  } catch (err) {
    throw new BitcoinSendError('SEND_REJECTED', errorMessage(err) || 'Send rejected');
  }

  if (response.status !== 'success') {
    throw new BitcoinSendError(
      'SEND_REJECTED',
      errorMessage(response.error) || 'Send rejected',
    );
  }
  if (!response.result?.txid) {
    throw new BitcoinSendError('INVALID_RESPONSE', 'Wallet did not return a txid.');
  }
  return { txid: response.result.txid };
};
