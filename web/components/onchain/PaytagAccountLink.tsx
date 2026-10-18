'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { OnchainLinkStatus } from '@paytagdev/sdk';
import { Badge } from '@/components/ui/Badge';
import { api } from '@/lib/api';
import { linkStatusOf } from '@/lib/onchain/linking';

/**
 * Whether the Paytag account of the same name is linked to this on-chain name. Fetched from the
 * browser (not during server rendering, which would put every visitor behind Vercel's shared
 * addresses in the API's per-IP limit). Best-effort: shows nothing when there's no account or
 * the status is unknown.
 */
export function PaytagAccountLink({ name }: { name: string }) {
  const [status, setStatus] = useState<OnchainLinkStatus | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    api
      .resolve(name, controller.signal)
      .then((resolution) => setStatus(linkStatusOf(resolution)))
      .catch(() => {});
    return () => controller.abort();
  }, [name]);

  if (status === 'linked') {
    return (
      <Link href={`/${name}`} title={`The Paytag account @${name} is linked to this name`}>
        <Badge className="hover:underline">Linked to paytag.dev/{name}</Badge>
      </Link>
    );
  }
  if (status === 'not_linked') {
    return (
      <span className="text-[13px] text-ink3">
        <Link href={`/${name}`} className="underline">
          paytag.dev/{name}
        </Link>{' '}
        is a separate Paytag account, not linked to this name.
      </span>
    );
  }
  return null;
}
