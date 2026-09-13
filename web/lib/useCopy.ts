'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useToast } from '@/components/ui/Toast';

/**
 * Copy to clipboard with the standard feedback: a toast, plus a `copied` flag
 * that stays true for `resetMs` so the button label can read "Copied".
 */
export function useCopy(resetMs = 1500) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = useCallback(
    async (value: string, message = 'Copied to clipboard'): Promise<boolean> => {
      try {
        await navigator.clipboard.writeText(value);
      } catch {
        toast('Couldn’t copy — select it and copy manually');
        return false;
      }
      setCopied(true);
      toast(message);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), resetMs);
      return true;
    },
    [toast, resetMs],
  );

  return { copied, copy };
}
