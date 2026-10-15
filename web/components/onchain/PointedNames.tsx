'use client';

import { useState } from 'react';
import { zeroHash } from 'viem';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { shortAddress } from '@/lib/format';
import { visiblePointing, type PointingName } from '@/lib/onchain/indexer';
import { addressUrl } from '@/lib/onchain/records';
import { useOnchainTx } from '@/lib/onchain/useOnchainTx';
import { TxStatus } from './TxStatus';

/**
 * Names someone else owns whose Ethereum record points at the connected wallet. The contract lets
 * the wallet claim any of them as its primary name (setReverse only checks the record), and
 * there's no NameCard for them, so this is also the only place to stop using one.
 */
export function PointedNames({
  names,
  primaryName,
  onChanged,
}: {
  names: PointingName[];
  primaryName: string | null;
  /** Primary name changed: the parent refetches its lists. */
  onChanged: () => void;
}) {
  const tx = useOnchainTx();
  const [action, setAction] = useState<string | null>(null);

  const shown = visiblePointing(names, primaryName);
  if (shown.length === 0) return null;

  const setPrimary = (target: PointingName, clear: boolean) => {
    if (tx.busy || tx.wrongNetwork) return;
    setAction(clear ? 'Clearing your primary name' : `Setting @${target.name} as primary name`);
    tx.run({ kind: 'setReverse', node: clear ? zeroHash : target.node }, { context: { name: target.name }, onIndexed: () => onChanged() });
  };

  return (
    <Card className="grid gap-4">
      <div className="grid gap-1">
        <h2 className="font-display text-[22px] font-semibold">Names that point at your wallet</h2>
        <p className="text-sm text-ink2">
          You don’t own these, but their Ethereum record is your address, so you can use one as your primary name. The
          owner controls the record: if they change it, it stops being your primary name.
        </p>
      </div>

      {action && tx.state.status !== 'idle' && (
        <div className="grid gap-1.5">
          <span className="text-[13px] font-semibold text-ink2">{action}</span>
          <TxStatus state={tx.state} />
        </div>
      )}

      <ul className="grid">
        {shown.map((n) => {
          const isPrimary = primaryName === n.name;
          return (
            <li key={n.node} className="flex flex-wrap items-center gap-3 border-t border-line py-3 first:border-t-0">
              <div className="grid min-w-0 gap-0.5">
                <span className="flex flex-wrap items-center gap-2.5">
                  <a href={`/on-chain/${n.name}`} className="break-all font-mono text-[19px] font-medium leading-tight hover:underline">
                    @{n.name}
                  </a>
                  {isPrimary && <Badge>Primary name</Badge>}
                </span>
                <span className="text-[13px] text-ink2">
                  Owned by{' '}
                  <a className="font-mono underline hover:text-ink" href={addressUrl(n.owner)} target="_blank" rel="noreferrer">
                    {shortAddress(n.owner)}
                  </a>
                </span>
              </div>
              <span className="ml-auto">
                {isPrimary ? (
                  <Button variant="outline-muted" size={40} onClick={() => setPrimary(n, true)} disabled={tx.busy || tx.wrongNetwork}>
                    Stop using as primary name
                  </Button>
                ) : (
                  <Button variant="outline" size={40} onClick={() => setPrimary(n, false)} disabled={tx.busy || tx.wrongNetwork}>
                    Make primary name
                  </Button>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
