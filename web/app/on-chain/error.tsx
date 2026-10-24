'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { MessageScreen } from '@/components/MessageScreen';
import { API_URL } from '@/lib/endpoints';

/** On-chain pages read the Base contracts through the Paytag API, so say where to check. */
export default function OnchainError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const host = API_URL.replace(/^https?:\/\//, '');
  return (
    <MessageScreen
      kicker="Something broke"
      title="We couldn’t load this page."
      copy="Your names and records are safe on Base; this page just couldn’t show them. Try again, or check the status page."
      primary={{ label: 'Try again', onClick: reset }}
      footnote={
        <>
          {error.digest && `ref ${error.digest} · `}
          {host} ·{' '}
          <Link className="underline hover:text-ink" href="/status">
            status
          </Link>
        </>
      }
    />
  );
}
