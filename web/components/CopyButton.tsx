'use client';

import { useState } from 'react';

interface Props {
  value: string;
  label?: string;
  variant?: 'quiet' | 'pill';
}

export function CopyButton({ value, label = 'Copy', variant = 'quiet' }: Props) {
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

  if (variant === 'pill') {
    return (
      <button onClick={onClick} className="btn-bare !py-2 !px-4 !text-[13px]">
        <span>{copied ? 'Copied' : label}</span>
      </button>
    );
  }

  return (
    <button onClick={onClick} className="btn-quiet">
      <span>{copied ? 'Copied' : label}</span>
    </button>
  );
}
