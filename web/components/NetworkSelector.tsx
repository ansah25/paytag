'use client';

import { useChainId, useSwitchChain } from 'wagmi';

export function NetworkSelector() {
  const currentChainId = useChainId();
  const { chains, switchChain, isPending, error, variables } = useSwitchChain();
  const pendingChainId = isPending ? variables?.chainId : undefined;

  return (
    <div className="space-y-2">
      <div className="eyebrow-muted">Network</div>
      <div className="inline-flex p-1 bg-paper border border-hairline rounded-full">
        {chains.map((chain) => {
          const active = chain.id === currentChainId;
          const switching = pendingChainId === chain.id;
          return (
            <button
              key={chain.id}
              type="button"
              onClick={() => !active && switchChain({ chainId: chain.id })}
              disabled={isPending}
              className={`relative px-4 py-2 text-[13px] font-semibold rounded-full transition-all ${
                active
                  ? 'bg-white text-ink shadow-soft'
                  : 'text-ink-3 hover:text-ink'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              <span>{switching ? 'Switching…' : chain.name}</span>
              {chain.testnet && (
                <span className="ml-2 numeric uppercase text-[9px] tracking-eyebrow text-ink-4">
                  Testnet
                </span>
              )}
            </button>
          );
        })}
      </div>
      {error && (
        <p className="text-xs text-danger">
          {(error as { shortMessage?: string }).shortMessage ?? error.message}
        </p>
      )}
    </div>
  );
}
