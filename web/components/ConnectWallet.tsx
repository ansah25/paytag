'use client';

import { useConnect, useDisconnect } from 'wagmi';

export function ConnectWallet() {
  const { connectors, connect, isPending, error } = useConnect();
  const injected = connectors.find((c) => c.type === 'injected') ?? connectors[0];

  return (
    <div className="space-y-3">
      <button
        onClick={() => injected && connect({ connector: injected })}
        disabled={!injected || isPending}
        className="bg-accent hover:opacity-90 disabled:opacity-40 text-white font-medium px-6 py-3 rounded-lg"
      >
        {isPending ? 'Connecting…' : 'Connect wallet'}
      </button>
      {error && <p className="text-sm text-red-300">{error.message}</p>}
      {!injected && (
        <p className="text-sm text-muted">
          No injected wallet detected. Install MetaMask or another browser wallet.
        </p>
      )}
    </div>
  );
}

export function DisconnectButton() {
  const { disconnect } = useDisconnect();
  return (
    <button
      onClick={() => disconnect()}
      className="text-sm text-muted hover:text-white"
    >
      Disconnect
    </button>
  );
}
