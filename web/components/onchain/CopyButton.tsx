'use client';

import { Button } from '@/components/ui/Button';
import { useCopy } from '@/lib/useCopy';

export function CopyButton({ value, label }: { value: string; label: string }) {
  const { copy, copied } = useCopy();
  return (
    <Button variant="outline-muted" size={36} onClick={() => copy(value, `${label} address copied`)} aria-label={`Copy ${label} address`}>
      {copied ? 'Copied' : 'Copy'}
    </Button>
  );
}
