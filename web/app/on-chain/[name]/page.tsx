import type { OnchainResolveResponse } from '@paytagdev/sdk';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { MessageScreen } from '@/components/MessageScreen';
import { CopyButton } from '@/components/onchain/CopyButton';
import { PaytagAccountLink } from '@/components/onchain/PaytagAccountLink';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { ChainDot } from '@/components/ui/ChainDot';
import { normalizeName } from '@/lib/onchain/generated/names';
import { onchainServerFetch } from '@/lib/onchain/serverApi';
import { RECORD_SLOTS, addressUrl } from '@/lib/onchain/records';

// Rendered on the server from the API's on-chain reads on every request: works with no wallet and no JS.
export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ name: string }>;
}

type Load =
  | { kind: 'ok'; data: OnchainResolveResponse; primary: boolean }
  | { kind: 'missing' }
  | { kind: 'unavailable' }
  | { kind: 'error' };

async function load(name: string): Promise<Load> {
  try {
    const res = await onchainServerFetch(`/resolve/${encodeURIComponent(name)}`);
    if (!res.ok) {
      // Only the API's own "not registered" is trusted: a bare 404 (a wrong route) isn't evidence.
      const body = (await res.json().catch(() => null)) as { code?: unknown } | null;
      if (res.status === 404 && body?.code === 'USER_NOT_FOUND') return { kind: 'missing' };
      return { kind: res.status === 503 ? 'unavailable' : 'error' };
    }
    const data = (await res.json()) as OnchainResolveResponse;

    // "Primary name" = the ETH address's reverse record points back here.
    let primary = false;
    const eth = data.addresses.ethereum;
    if (eth) {
      const rev = await onchainServerFetch(`/reverse/${eth}`).catch(() => null);
      const body = rev?.ok ? ((await rev.json()) as { username: string | null }) : null;
      primary = body?.username === data.username;
    }
    return { kind: 'ok', data, primary };
  } catch {
    return { kind: 'error' };
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const parsed = normalizeName(decodeURIComponent((await params).name));
  return { title: parsed.ok ? `@${parsed.name} on Base · Paytag` : 'Paytag' };
}

export default async function OnchainNamePage({ params }: Props) {
  const parsed = normalizeName(decodeURIComponent((await params).name));
  if (!parsed.ok) notFound();
  const name = parsed.name;
  const result = await load(name);

  if (result.kind === 'missing') {
    return (
      <MessageScreen
        kicker="Not registered"
        tone="muted"
        title={`@${name} isn’t registered on-chain.`}
        copy={`Nobody owns this name on the Base registry yet. On-chain names are separate from Paytag accounts, so @${name} may still exist as one at paytag.dev/${name}.`}
        primary={{ label: 'Register a name', href: '/on-chain' }}
      />
    );
  }
  if (result.kind === 'unavailable' || result.kind === 'error') {
    return (
      <MessageScreen
        kicker={result.kind === 'unavailable' ? 'Base is unreachable' : 'Something broke'}
        tone="muted"
        title={result.kind === 'unavailable' ? 'We couldn’t read the Base registry.' : 'We couldn’t load this name.'}
        copy="On-chain data is safe; this page just can’t read it right now. Try again in a moment."
        primary={{ label: 'Try again', href: `/on-chain/${name}` }}
      />
    );
  }

  const { data, primary } = result;
  const bySlot = new Map(data.records.map((r) => [r.coinType, r]));
  const extra = data.records.filter((r) => !RECORD_SLOTS.some((s) => s.coinType.toString() === r.coinType));

  return (
    <section className="mx-auto grid w-full max-w-content gap-7 px-6 pb-24 pt-12">
      <div className="animate-enter">
        <span className="font-mono text-[12px] uppercase tracking-kicker text-ink2">Base Sepolia · on-chain · separate from Paytag accounts</span>
        <h1 className="mt-2 break-all font-mono text-[clamp(32px,4.5vw,52px)] font-medium leading-none">
          @{data.username}
        </h1>
        <div className="mt-3 flex flex-wrap items-center gap-2.5 text-sm text-ink2">
          <span className="min-w-0">
            Owned by{' '}
            <a className="break-all font-mono text-ink underline" href={addressUrl(data.owner)} target="_blank" rel="noreferrer">
              {data.owner}
            </a>
          </span>
          {primary && <Badge>Primary name</Badge>}
          <PaytagAccountLink name={data.username} />
        </div>
      </div>

      {data.recordsReset && (
        <p className="rounded-inset-sm bg-warn-bg px-4 py-3 text-sm font-semibold text-warn">
          @{data.username} changed owner recently and the new owner hasn’t set any addresses yet. Don’t send to it until
          they do.
        </p>
      )}

      <Card className="grid gap-1" padding="compact">
        <h2 className="mb-2 font-display text-lg font-semibold">Addresses</h2>
        {RECORD_SLOTS.map((slot) => {
          const record = bySlot.get(slot.coinType.toString());
          const usable = record && record.address;
          return (
            <div key={slot.label} className="flex flex-wrap items-center gap-3 border-t border-line py-3 first:border-t-0">
              {slot.chain ? <ChainDot chain={slot.chain} muted={!usable} /> : <span className="h-2.5 w-2.5 rounded-full bg-ink3" aria-hidden />}
              <span className="w-24 shrink-0 text-sm font-semibold">{slot.label}</span>
              {record ? (
                <>
                  <span className="order-last min-w-0 basis-full break-all font-mono text-[13px] text-ink sm:order-none sm:basis-0 sm:flex-1">{record.address ?? record.value}</span>
                  {!record.address && <Badge tone="muted">Unrecognised format</Badge>}
                  {usable && <CopyButton value={record.address!} label={slot.label} />}
                </>
              ) : (
                <span className="flex-1 text-sm text-ink3">Not set</span>
              )}
            </div>
          );
        })}
        {extra.map((r) => (
          <div key={r.coinType} className="flex flex-wrap items-center gap-3 border-t border-line py-3">
            <span className="w-24 shrink-0 text-sm font-semibold">Coin {r.coinType}</span>
            <span className="min-w-0 flex-1 break-all font-mono text-[13px] text-ink">{r.address ?? r.value}</span>
          </div>
        ))}
      </Card>
      <p className="text-[13px] text-ink2">
        Read straight from the Base contracts. A transfer clears every record on-chain, so these were all set by the
        current owner.
      </p>
    </section>
  );
}
