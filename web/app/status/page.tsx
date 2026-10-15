import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { CopyButton } from '@/components/onchain/CopyButton';
import { AutoRefresh } from '@/components/status/AutoRefresh';
import { Card } from '@/components/ui/Card';
import { cx } from '@/lib/cx';
import { CHAIN_ID, REGISTRY_ADDRESS, RESOLVER_ADDRESS, START_BLOCK } from '@/lib/onchain/generated/deployment';
import { INDEXER_URL } from '@/lib/onchain/indexer';
import { EXPLORER, addressUrl } from '@/lib/onchain/records';
import { BASE_BLOCK_SECONDS, getStatus, type Health } from '@/lib/status';

// Live checks on every request (and every 15s via AutoRefresh).
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Status · Paytag',
  description: 'Live health of the Paytag API, the on-chain indexer and the Base contracts.',
};

const LABEL: Record<Health, string> = { ok: 'Operational', degraded: 'Degraded', down: 'Down' };
const OVERALL: Record<Health, string> = {
  ok: 'All systems operational',
  degraded: 'Some systems degraded',
  down: 'Partial outage',
};

function Pill({ health }: { health: Health }) {
  return (
    <span
      className={cx(
        'inline-flex shrink-0 items-center gap-1.5 rounded-pill px-2.5 py-1 text-[12px] font-bold',
        health === 'ok' && 'bg-ok-bg text-ok',
        health === 'degraded' && 'bg-warn-bg text-warn',
        health === 'down' && 'bg-danger-bg text-danger',
      )}
    >
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
      {LABEL[health]}
    </span>
  );
}

function Row({ title, detail, children }: { title: string; detail?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line py-3.5 first:border-t-0 first:pt-0 last:pb-0">
      <div className="grid min-w-0 flex-1 basis-[220px] gap-0.5">
        <span className="text-sm font-semibold">{title}</span>
        {detail && <span className="break-words text-[13px] text-ink2">{detail}</span>}
      </div>
      {children}
    </div>
  );
}

const ext = { target: '_blank', rel: 'noreferrer' } as const;
const link = 'underline hover:text-ink';

function Contract({ name, address }: { name: string; address: string }) {
  return (
    <Row
      title={name}
      detail={
        <>
          <span className="block break-all font-mono text-ink">{address}</span>
          Verified on{' '}
          <a className={link} href={`${addressUrl(address)}#code`} {...ext}>
            Basescan
          </a>{' '}
          and{' '}
          <a className={link} href={`https://repo.sourcify.dev/${CHAIN_ID}/${address}`} {...ext}>
            Sourcify
          </a>
        </>
      }
    >
      <CopyButton value={address} label={name} />
    </Row>
  );
}

export default async function StatusPage() {
  const s = await getStatus();
  const { indexer } = s;
  const lagSeconds = indexer.lagBlocks === null ? null : indexer.lagBlocks * BASE_BLOCK_SECONDS;

  return (
    <section className="mx-auto grid w-full max-w-content gap-6 px-6 pb-24 pt-12">
      <div className="animate-enter grid gap-3">
        <h1 className="font-display text-[clamp(32px,4.5vw,52px)] font-semibold leading-none tracking-display-lg">Status</h1>
        <div className="flex flex-wrap items-center gap-3">
          <Pill health={s.overall} />
          <span className="text-[15px] font-semibold">{OVERALL[s.overall]}</span>
        </div>
        <AutoRefresh checkedAt={s.checkedAt} />
      </div>

      <Card className="grid">
        <h2 className="mb-3 font-display text-[20px] font-semibold">Services</h2>
        <Row
          title="Paytag API"
          detail={
            <>
              Off-chain names and profiles ·{' '}
              <a className={link} href="https://api.paytag.dev/health" {...ext}>
                api.paytag.dev
              </a>
              {s.api.latencyMs !== null && ` · ${s.api.latencyMs} ms`}
            </>
          }
        >
          <Pill health={s.api.health} />
        </Row>
        <Row
          title="On-chain indexer"
          detail={
            <>
              {indexer.reason}
              {lagSeconds !== null && lagSeconds > 0 && ` (~${lagSeconds}s)`} ·{' '}
              <a className={link} href={`${INDEXER_URL}/status`} {...ext}>
                {INDEXER_URL.replace(/^https?:\/\//, '')}
              </a>
            </>
          }
        >
          <Pill health={indexer.health} />
        </Row>
        <Row
          title="Blocks"
          detail={
            <>
              Indexed{' '}
              <span className="font-mono text-ink">{indexer.syncedBlock?.toLocaleString('en-US') ?? '—'}</span> · Chain head{' '}
              <span className="font-mono text-ink">{indexer.headBlock?.toLocaleString('en-US') ?? 'unavailable'}</span>
            </>
          }
        />
      </Card>

      <Card className="grid">
        <h2 className="mb-1 font-display text-[20px] font-semibold">Contracts</h2>
        <p className="mb-3 text-[13px] text-ink2">
          Base Sepolia (chain {CHAIN_ID}) · deployed at block{' '}
          <a className={link} href={`${EXPLORER}/block/${START_BLOCK}`} {...ext}>
            {START_BLOCK.toLocaleString('en-US')}
          </a>{' '}
          · immutable, no admin keys
        </p>
        <Contract name="PaytagRegistry" address={REGISTRY_ADDRESS} />
        <Contract name="PaytagResolver" address={RESOLVER_ADDRESS} />
      </Card>

      <Card className="grid">
        <h2 className="mb-3 font-display text-[20px] font-semibold">For developers</h2>
        <Row
          title="@paytagdev/sdk"
          detail={
            <>
              {s.sdkVersion ? `Latest ${s.sdkVersion}` : 'Version unavailable'} ·{' '}
              <a className={link} href="https://www.npmjs.com/package/@paytagdev/sdk" {...ext}>
                npm
              </a>
            </>
          }
        />
        <Row
          title="Indexer API"
          detail={
            <>
              <span className="font-mono text-ink">/resolve/:name</span>, <span className="font-mono text-ink">/reverse/:address</span>,{' '}
              <span className="font-mono text-ink">/available/:name</span>, <span className="font-mono text-ink">/names?owner=</span>,{' '}
              <a className={link} href={`${INDEXER_URL}/graphql`} {...ext}>
                GraphQL
              </a>
              . Rate-limited per address; a 429 carries Retry-After.
            </>
          }
        />
      </Card>
    </section>
  );
}
