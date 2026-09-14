interface Messages {
  fallback: string;
  /** User dismissed the request in the wallet. */
  rejected?: string;
  /** No injected provider (EVM connect). */
  notFound?: string;
}

type ErrorLike = { name?: unknown; code?: unknown; shortMessage?: unknown; message?: unknown; cause?: unknown };

const MAX_LENGTH = 160;

/**
 * Turn wallet/RPC errors into one readable line. viem nests the real reason in
 * `cause`, so walk the chain before falling back to the top-level message.
 */
export function walletErrorMessage(err: unknown, messages: Messages): string {
  const chain: ErrorLike[] = [];
  let current: unknown = err;
  for (let depth = 0; current && typeof current === 'object' && depth < 5; depth += 1) {
    chain.push(current as ErrorLike);
    current = (current as ErrorLike).cause;
  }

  const names = chain.map((e) => e.name);
  if (messages.notFound && names.includes('ProviderNotFoundError')) return messages.notFound;

  const text = chain
    .map((e) => `${typeof e.shortMessage === 'string' ? e.shortMessage : ''} ${typeof e.message === 'string' ? e.message : ''}`)
    .join(' ');
  const rejected =
    names.includes('UserRejectedRequestError') ||
    chain.some((e) => e.code === 4001) ||
    /user rejected|rejected the request|user denied|user cancel|request was cancel/i.test(text);
  if (rejected) return messages.rejected ?? 'Request was rejected in the wallet.';

  const top = chain[0];
  const readable =
    (typeof top?.shortMessage === 'string' && top.shortMessage) ||
    (typeof top?.message === 'string' && top.message) ||
    '';
  return readable && readable.length <= MAX_LENGTH ? readable : messages.fallback;
}
