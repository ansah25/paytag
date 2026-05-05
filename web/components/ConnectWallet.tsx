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
        className="btn-primary"
      >
        <span>{isPending ? 'Connecting…' : 'Connect wallet'}</span>
      </button>
      {error && <p className="text-sm text-danger">{error.message}</p>}
      {!injected && (
        <p className="text-sm text-ink-3">
          No injected wallet detected. Install MetaMask or another browser wallet.
        </p>
      )}
    </div>
  );
}

export function DisconnectButton() {
  const { disconnect } = useDisconnect();
  return (
    <button onClick={() => disconnect()} className="btn-quiet">
      Disconnect
    </button>
  );
}
