import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import type { ResolveResponse } from '@/lib/api';
import { cx } from '@/lib/cx';
import { dashboardLinkCopy, linkStatusOf } from '@/lib/onchain/linking';

interface Props {
  username: string;
  resolution: ResolveResponse | null;
}

const KICKER_TONE = { ok: 'text-ok', warn: 'text-warn', muted: 'text-ink2' } as const;

/** "Your on-chain name": whether the same name on the Base registry is linked to this account. */
export function OnchainCard({ username, resolution }: Props) {
  if (!resolution) {
    return (
      <Card className="grid content-start gap-3" aria-busy="true">
        <Skeleton className="h-3.5 w-[120px]" />
        <Skeleton className="h-[26px] w-[220px] max-w-full" delay={150} />
      </Card>
    );
  }

  const copy = dashboardLinkCopy(username, linkStatusOf(resolution), !!resolution.verified?.ethereum);
  return (
    <Card className="grid content-start gap-4">
      <div>
        <div className={cx('text-[13px] font-semibold', KICKER_TONE[copy.tone])}>Your on-chain name</div>
        <h2 className="mt-1.5 break-words font-display text-[26px] font-semibold tracking-display-md">{copy.title}</h2>
      </div>
      <p className="text-[15px] leading-[1.55] text-ink2">{copy.body}</p>
      {copy.action && (
        <Button variant="outline" size={40} href={copy.action.href} className="justify-self-start">
          {copy.action.label}
        </Button>
      )}
    </Card>
  );
}
