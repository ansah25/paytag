'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { CopyButton } from '@/components/CopyButton';
import { Avatar } from '@/components/Avatar';

export default function WelcomePage() {
  return (
    <Suspense fallback={<div className="text-ink-3 p-10">Loading…</div>}>
      <WelcomeContent />
    </Suspense>
  );
}

function WelcomeContent() {
  const params = useSearchParams();
  const username = params.get('u') ?? '';
  const [origin, setOrigin] = useState('paytag.dev');

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setOrigin(window.location.host);
    }
  }, []);

  if (!username) {
    return (
      <div className="max-w-[1240px] mx-auto px-6 md:px-10 py-20">
        <p className="text-ink-3 mb-3">No username specified.</p>
        <Link href="/" className="text-primary font-semibold hover:underline">
          ← Back home
        </Link>
      </div>
    );
  }

  const link =
    typeof window !== 'undefined'
      ? `${window.location.origin}/${username}`
      : `https://${origin}/${username}`;

  return (
    <section className="relative overflow-hidden">
      <div className="relative max-w-[1240px] mx-auto px-6 md:px-10 py-16 md:py-24">
        {/* Hero block */}
        <div className="max-w-3xl animate-rise rise-1">
          <div className="inline-flex items-center gap-2 bg-white/80 backdrop-blur border border-hairline rounded-full px-3 py-1.5 mb-6 text-xs font-semibold text-success">
            <span className="w-1.5 h-1.5 rounded-full bg-success" />
            <span>Successfully registered</span>
          </div>
          <h1 className="font-display font-bold text-5xl md:text-7xl lg:text-[88px] leading-[0.95] text-ink tracking-tightest">
            <span
              className="inline-block bg-clip-text text-transparent"
              style={{
                backgroundImage:
                  'linear-gradient(110deg, #5469D4 0%, #7E5CFF 35%, #FF5A6E 75%, #FFB547 100%)',
                // Pad the gradient bounding box on every side so tight
                // line-height + tracking-tightest don't clip the bottom of
                // letters or the right edge. Negative margin keeps layout
                // unchanged.
                padding: '0.05em 0.1em 0.08em',
                margin: '-0.05em -0.1em -0.08em',
              }}
            >
              @{username}
            </span>
            <br />
            is yours.
          </h1>
          <p className="mt-6 text-lg md:text-xl text-ink-2 max-w-xl">
            Anyone with a wallet can now send you crypto using one link. No install, no
            extension, no copy-paste.
          </p>
        </div>

        <div className="mt-12 grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 max-w-5xl">
          {/* Share link card */}
          <div className="lg:col-span-7 card card-hover p-6 md:p-8 animate-rise rise-2 relative overflow-hidden">
            <div className="relative">
              <div className="flex items-center gap-4 mb-6">
                <Avatar username={username} size={56} />
                <div>
                  <div className="eyebrow mb-1">Your share link</div>
                  <div className="font-display font-bold text-xl text-ink">@{username}</div>
                </div>
              </div>
              <div className="bg-paper border border-hairline rounded-xl p-4 font-mono text-base text-ink break-all numeric">
                {origin}/{username}
              </div>
              <div className="mt-5 flex flex-wrap gap-3">
                <Link href="/app" className="btn-primary">
                  <span>Open dashboard</span>
                  <span aria-hidden>→</span>
                </Link>
                <CopyButton value={link} label="Copy link" variant="pill" />
                <Link href={`/${username}`} className="btn-bare">
                  Public page
                </Link>
              </div>
            </div>
          </div>

          {/* Stats */}
          <div className="lg:col-span-5 grid grid-cols-3 gap-4 animate-rise rise-3 lg:pt-2">
            {[
              { l: 'Length', v: `${username.length}` },
              { l: 'Chains', v: '3' },
              { l: 'Cost', v: '$0' },
            ].map((s) => (
              <div key={s.l} className="card p-5 text-center">
                <div className="font-display font-bold text-3xl md:text-4xl text-ink leading-none numeric">
                  {s.v}
                </div>
                <div className="eyebrow-muted mt-2.5">{s.l}</div>
              </div>
            ))}
            <div className="col-span-3 card card-hover p-5 relative overflow-hidden">
              <div className="relative">
                <div className="eyebrow-muted mb-1">Next step</div>
                <p className="text-sm text-ink-2">
                  Add Solana and Bitcoin addresses on your dashboard so people can pay you on
                  any chain.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
