'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';
import { AddressText } from '@/components/ui/AddressText';
import { Badge } from '@/components/ui/Badge';
import { Button, type ButtonSize, type ButtonVariant } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ChainDot } from '@/components/ui/ChainDot';
import { Field, type FieldStatus } from '@/components/ui/Field';
import { SegmentedRail } from '@/components/ui/SegmentedRail';
import { PulseDot, Skeleton, SkeletonStatus } from '@/components/ui/Skeleton';
import { Spinner } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';
import { useCopy } from '@/lib/useCopy';

const VARIANTS: ButtonVariant[] = ['accent', 'solid', 'outline', 'outline-muted', 'ghost', 'danger-outline'];
const SIZES: ButtonSize[] = [36, 40, 44, 48, 56];

const CLAIM_STATES: Array<{
  status: FieldStatus;
  value: string;
  message: string;
  tone: 'muted' | 'ok' | 'danger';
}> = [
  { status: 'idle', value: '', message: '', tone: 'muted' },
  { status: 'checking', value: 'derrick', message: 'Checking…', tone: 'muted' },
  { status: 'valid', value: 'derrick', message: 'Available — it’s yours.', tone: 'ok' },
  { status: 'error', value: 'alice', message: 'Already taken.', tone: 'danger' },
];

const EVM = '0x9a1b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f4e2f';
const SOL = '7Gk2pQv9xYt3LmN8rB4sW6cD1eF5hJ0kZ2aUmQ9x';

export function UiKit() {
  const toast = useToast();
  const { copied, copy } = useCopy();
  const [tab, setTab] = useState<'overview' | 'profile' | 'settings'>('overview');
  const [chain, setChain] = useState<'ethereum' | 'solana' | 'bitcoin'>('ethereum');
  const [saving, setSaving] = useState(false);
  const [bio, setBio] = useState('');

  const simulateSave = () => {
    setSaving(true);
    setTimeout(() => {
      setSaving(false);
      toast('Profile saved');
    }, 1600);
  };

  return (
    <div className="mx-auto grid w-full max-w-content gap-6 px-6 pb-24 pt-12">
      <header className="grid gap-2">
        <div className="text-[13px] font-semibold text-accent">Internal</div>
        <h1 className="font-display text-[clamp(36px,5vw,60px)] font-semibold leading-none tracking-display-lg">
          UI kit
        </h1>
        <p className="max-w-[560px] text-ink2">
          Every primitive in every state. Use the header toggle to check both themes. This route
          returns 404 in production.
        </p>
      </header>

      <Section title="Button" note="variants × sizes 36 / 40 / 44 / 48 / 56">
        {VARIANTS.map((variant) => (
          <Row key={variant} label={variant}>
            {SIZES.map((size) => (
              <Button key={size} variant={variant} size={size}>
                {`Button ${size}`}
              </Button>
            ))}
          </Row>
        ))}
        <Row label="states">
          <Button loading={saving} loadingLabel="Saving…" onClick={simulateSave}>
            Save profile
          </Button>
          <Button variant="solid" loading loadingLabel="Waiting for signature…">
            Sign in with wallet
          </Button>
          <Button disabled>Review 0 ETH</Button>
          <Button variant="outline" href="/">
            Internal link
          </Button>
          <Button variant="outline-muted" size={36} href="https://api.paytag.dev/health">
            External ↗
          </Button>
        </Row>
        <Row label="fullWidth">
          <Button size={56} fullWidth>
            Confirm and sign
          </Button>
        </Row>
      </Section>

      <Section title="Field" note="pill (claim / recipient) and inset (forms)">
        {CLAIM_STATES.map((s) => (
          <Row key={s.status} label={s.status}>
            <Field
              wrapperClassName="w-full max-w-[560px]"
              size="xl"
              at
              defaultValue={s.value}
              placeholder="yourname"
              status={s.status}
              message={s.message}
              messageTone={s.tone}
              hint="3–20 letters, numbers, _"
              aria-label={`Claim input (${s.status})`}
              trailing={
                <Button size={48} disabled={s.status !== 'valid'}>
                  Claim
                </Button>
              }
            />
          </Row>
        ))}
        <Row label="lg (final CTA)">
          <Field
            wrapperClassName="w-full max-w-[480px]"
            size="lg"
            at
            placeholder="yourname"
            aria-label="Claim input large"
            trailing={<Button size={48}>Claim</Button>}
          />
        </Row>
        <Row label="md pill">
          <Field wrapperClassName="w-full max-w-[420px]" placeholder="Search" aria-label="Search" />
        </Row>
        <Row label="inset">
          <Field
            wrapperClassName="w-full max-w-[420px]"
            shape="inset"
            label="Display name"
            placeholder="Derrick Ansah"
            maxLength={40}
          />
          <Field
            wrapperClassName="w-full max-w-[420px]"
            shape="inset"
            label="Bio"
            placeholder="What you do"
            maxLength={120}
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            hint={`${bio.length}/120`}
            message=""
          />
        </Row>
        <Row label="inset mono error">
          <Field
            wrapperClassName="w-full max-w-[520px]"
            shape="inset"
            mono
            status="error"
            defaultValue="0x9a1b"
            aria-label="Ethereum address"
            message="Enter a 0x address with 40 hex characters."
            messageTone="danger"
          />
        </Row>
      </Section>

      <Section title="Card">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-4">
          <Card>
            <CardBody title="Default" copy="24px radius, surface, 1px line, clamp(22px, 3vw, 32px) padding." />
          </Card>
          <Card elevated>
            <CardBody title="Elevated" copy="Emphasized border and the floating shadow." />
          </Card>
          <Card padding="compact">
            <CardBody title="Compact" copy="22px padding for aside cards." />
          </Card>
        </div>
      </Section>

      <Section title="Badge">
        <Row label="md">
          <Badge>Verified</Badge>
          <Badge tone="muted">Unverified</Badge>
          <Badge tone="warn">Setup</Badge>
        </Row>
        <Row label="sm">
          <Badge size="sm">Verified</Badge>
          <Badge size="sm" tone="muted">
            Unverified
          </Badge>
          <Badge size="sm" tone="warn">
            3/6 confirmations
          </Badge>
        </Row>
      </Section>

      <Section title="Skeleton">
        <SkeletonStatus>Restoring your session…</SkeletonStatus>
        <div className="flex items-center gap-4">
          <Skeleton shape="circle" className="h-16 w-16" />
          <div className="grid gap-2.5">
            <Skeleton className="h-10 w-[200px] max-w-[55vw]" />
            <Skeleton className="h-3.5 w-[140px]" delay={200} />
          </div>
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-4">
          <Skeleton shape="card" className="h-[160px]" delay={100} />
          <Skeleton shape="block" className="h-[160px]" delay={300} />
        </div>
      </Section>

      <Section title="SegmentedRail" note="arrow keys / Home / End move between tabs">
        <Row label="40 (tabs)">
          <SegmentedRail
            label="Dashboard sections"
            value={tab}
            onChange={setTab}
            items={[
              { id: 'overview', label: 'Overview' },
              { id: 'profile', label: 'Profile' },
              { id: 'settings', label: 'Settings' },
            ]}
          />
        </Row>
        <Row label="44 fill (chains)">
          <SegmentedRail
            label="Pay with"
            size={44}
            fill
            value={chain}
            onChange={setChain}
            className="max-w-[560px]"
            items={[
              { id: 'ethereum', label: <ChainTab chain="ethereum" name="Ethereum" symbol="ETH" /> },
              { id: 'solana', label: <ChainTab chain="solana" name="Solana" symbol="SOL" /> },
              { id: 'bitcoin', label: <ChainTab chain="bitcoin" name="Bitcoin" symbol="BTC" /> },
            ]}
          />
        </Row>
      </Section>

      <Section title="Toast">
        <Row label="triggers">
          <Button variant="solid" onClick={() => toast('Link copied')}>
            Show toast
          </Button>
          <Button variant="outline-muted" size={36} onClick={() => copy(EVM, 'Address copied')}>
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </Row>
      </Section>

      <Section title="Misc">
        <Row label="spinner / dots">
          <span className="text-ink">
            <Spinner />
          </span>
          <span className="text-accent">
            <Spinner size={12} />
          </span>
          <PulseDot />
          <ChainDot chain="ethereum" />
          <ChainDot chain="solana" />
          <ChainDot chain="bitcoin" />
          <ChainDot chain="bitcoin" muted />
        </Row>
        <Row label="AddressText">
          <div className="grid w-full gap-2 text-[13px]">
            <AddressText address={EVM} />
            <div className="max-w-[200px] rounded-inset-sm bg-surface2 px-3 py-2">
              <AddressText address={SOL} />
            </div>
          </div>
        </Row>
      </Section>
    </div>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <Card as="section" className="grid gap-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-[26px] font-semibold tracking-display">{title}</h2>
        {note && <span className="text-[13px] text-ink2">{note}</span>}
      </div>
      {children}
    </Card>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <code className="w-full font-mono text-xs text-ink2 sm:w-32">{label}</code>
      {children}
    </div>
  );
}

function CardBody({ title, copy }: { title: string; copy: string }) {
  return (
    <div className="grid gap-2">
      <h3 className="font-display text-[20px] font-semibold tracking-display">{title}</h3>
      <p className="text-[15px] text-ink2">{copy}</p>
    </div>
  );
}

function ChainTab({
  chain,
  name,
  symbol,
}: {
  chain: 'ethereum' | 'solana' | 'bitcoin';
  name: string;
  symbol: string;
}) {
  return (
    <>
      <ChainDot chain={chain} size={8} />
      {name}
      <span className="font-mono text-xs text-ink3">{symbol}</span>
    </>
  );
}
