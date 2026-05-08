'use client';

import { useEffect, useRef, useState } from 'react';

// One-shot scroll-reveal hook. Disconnects after the first intersection so we
// don't pay observer overhead for the rest of the session — we only need to
// know "has this scrolled into view yet".
export function useInView<T extends HTMLElement = HTMLElement>(
  options: IntersectionObserverInit = {
    threshold: 0.12,
    rootMargin: '0px 0px -8% 0px',
  },
) {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Reduced-motion users get the final state immediately, no observer.
    if (
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    ) {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (entry.isIntersecting) {
          setInView(true);
          observer.disconnect();
        }
      },
      options,
    );
    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return [ref, inView] as const;
}
