'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

/** Re-runs the server checks every `seconds` while the tab is visible, and says when they last ran. */
export function AutoRefresh({ checkedAt, seconds = 15 }: { checkedAt: number; seconds?: number }) {
  const router = useRouter();
  const [time, setTime] = useState<string | null>(null);

  // Formatted after mount, in the viewer's own time zone (the server doesn't know it).
  useEffect(() => setTime(new Date(checkedAt).toLocaleTimeString()), [checkedAt]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh();
    }, seconds * 1000);
    return () => clearInterval(timer);
  }, [router, seconds]);

  return (
    <span className="text-[13px] text-ink2" aria-live="polite">
      {time ? `Checked at ${time} · refreshes every ${seconds}s` : `Refreshes every ${seconds}s`}
    </span>
  );
}
