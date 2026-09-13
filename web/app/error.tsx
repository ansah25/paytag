'use client';

import { useEffect } from 'react';
import { MessageScreen } from '@/components/MessageScreen';

const apiHost = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000').host;
  } catch {
    return 'api.paytag.dev';
  }
})();

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <MessageScreen
      kicker="Something broke"
      title="We couldn’t load this page."
      copy="The resolver didn’t answer. Your wallets and names are unaffected — this is on our side. Try again in a moment."
      primary={{ label: 'Try again', onClick: reset }}
      // Server errors carry a digest that matches the server log line.
      footnote={error.digest ? `ref ${error.digest} · ${apiHost}` : apiHost}
    />
  );
}
