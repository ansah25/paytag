'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useCopy } from '@/lib/useCopy';

export function ReceiveCard({ username }: { username: string }) {
  const { copied, copy } = useCopy();
  const [origin, setOrigin] = useState('https://paytag.dev');
  useEffect(() => setOrigin(window.location.origin), []);

  const link = `${origin}/${username}`;
  const host = origin.replace(/^https?:\/\//, '');
  const shareText = `Pay me with @${username} on Paytag`;
  const enc = encodeURIComponent;
  const intents = [
    { label: 'X', title: 'Share on X', href: `https://twitter.com/intent/tweet?text=${enc(shareText)}&url=${enc(link)}` },
    { label: 'WhatsApp', title: 'Share on WhatsApp', href: `https://wa.me/?text=${enc(`${shareText} ${link}`)}` },
    { label: 'iMessage', title: 'Share by message', href: `sms:?&body=${enc(`${shareText} ${link}`)}` },
    {
      label: 'Email',
      title: 'Share by email',
      href: `mailto:?subject=${enc('Pay me on Paytag')}&body=${enc(`${shareText}\n\n${link}`)}`,
    },
  ];

  return (
    <Card className="grid content-start gap-[18px]">
      <div>
        <div className="text-[13px] font-semibold text-accent">Receive</div>
        <h2 className="mt-1.5 font-display text-[26px] font-semibold tracking-display-md">Share to get paid</h2>
      </div>
      <div className="break-all rounded-inset-lg bg-surface2 px-[22px] py-5 font-display text-[clamp(22px,3vw,34px)] font-semibold leading-[1.1] tracking-display-md">
        <span className="text-ink3">{host}/</span>
        <span className="text-accent">{username}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="solid" onClick={() => void copy(link, 'Link copied')}>
          {copied ? 'Copied' : 'Copy link'}
        </Button>
        {intents.map((intent) => (
          <Button key={intent.label} variant="outline" href={intent.href} aria-label={intent.title} className="px-4">
            {intent.label}
          </Button>
        ))}
      </div>
      <Link href={`/${username}`} className="justify-self-start text-sm font-semibold text-accent">
        Open public page →
      </Link>
    </Card>
  );
}
