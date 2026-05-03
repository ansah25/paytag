'use client';

import { useState } from 'react';

interface Props {
  value: string;
  label?: string;
}

export function CopyButton({ value, label = 'Copy' }: Props) {
  const [copied, setCopied] = useState(false);

  const onClick = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  return (
    <button
      onClick={onClick}
      className="text-xs text-muted hover:text-white border border-border rounded px-2 py-1"
    >
      {copied ? 'Copied' : label}
    </button>
  );
}
