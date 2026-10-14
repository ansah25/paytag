'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { getAddress, isAddress } from 'viem';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Field } from '@/components/ui/Field';
import { normalizeName } from '@/lib/onchain/generated/names';
import { indexer } from '@/lib/onchain/indexer';

type Result =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'reverse'; address: string; username: string | null }
  | { kind: 'error'; message: string };

/**
 * Public lookup, no wallet needed: a name opens its resolve page; an address shows the name it
 * has claimed as primary (forward-verified, so a stale claim reads as none).
 */
export function LookupPanel() {
  const router = useRouter();
  const [input, setInput] = useState('');
  const [result, setResult] = useState<Result>({ kind: 'idle' });

  const submit = async () => {
    const value = input.trim();
    if (!value) return;
    if (isAddress(value, { strict: false })) {
      setResult({ kind: 'loading' });
      try {
        const r = await indexer.reverse(value);
        setResult({ kind: 'reverse', address: getAddress(value), username: r.username });
      } catch (err) {
        setResult({ kind: 'error', message: (err as Error).message });
      }
      return;
    }
    const parsed = normalizeName(value);
    if (!parsed.ok) return setResult({ kind: 'error', message: `Enter a name or a 0x address (${parsed.reason}).` });
    router.push(`/on-chain/${parsed.name}`);
  };

  return (
    <Card className="grid gap-4">
      <div>
        <h2 className="font-display text-[22px] font-semibold">Look up</h2>
        <p className="mt-1 text-sm text-ink2">A name shows its addresses. An address shows its primary name.</p>
      </div>
      <Field
        shape="inset"
        autoComplete="off"
        spellCheck={false}
        aria-label="Name or address"
        placeholder="@derrick or 0x…"
        value={input}
        onChange={(e) => {
          setInput(e.target.value);
          setResult({ kind: 'idle' });
        }}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        trailing={
          <Button variant="outline" size={36} onClick={submit} loading={result.kind === 'loading'}>
            Look up
          </Button>
        }
      />
      {result.kind === 'reverse' && (
        <p className="break-all text-sm" aria-live="polite">
          <span className="font-mono text-ink2">{result.address}</span>{' '}
          {result.username ? (
            <>
              is{' '}
              <Link className="font-semibold text-ink underline" href={`/on-chain/${result.username}`}>
                @{result.username}
              </Link>
            </>
          ) : (
            <span className="text-ink2">has no primary name.</span>
          )}
        </p>
      )}
      {result.kind === 'error' && (
        <p className="text-sm font-semibold text-danger" role="alert">
          {result.message}
        </p>
      )}
    </Card>
  );
}
