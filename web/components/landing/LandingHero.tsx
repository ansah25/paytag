'use client';

import { useState } from 'react';
import { ClaimInput } from '@/components/ClaimInput';
import { IdentityCard } from './IdentityCard';

const PREVIEW_NAME = 'nadia';

export function LandingHero() {
  // The card previews the typed name once it's confirmed available.
  const [preview, setPreview] = useState<string | null>(null);

  return (
    <>
      <section className="mx-auto w-full max-w-content px-6 pb-10 pt-16 text-center">
        <div className="inline-flex animate-enter-slow items-center gap-2 rounded-pill border border-line px-3.5 py-1.5 text-[13px] font-semibold text-ink2">
          <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
          Public beta · names are first come, first served
        </div>
        <h1 className="mx-auto mt-7 max-w-[900px] animate-enter-slow font-display text-[clamp(44px,6.5vw,92px)] font-semibold leading-[0.98] tracking-display-lg [animation-delay:50ms] [text-wrap:balance]">
          Get paid to a name, not an address.
        </h1>
        <p className="mx-auto mt-6 max-w-[560px] animate-enter-slow text-[19px] leading-[1.55] text-ink2 [animation-delay:100ms] [text-wrap:pretty]">
          Paytag turns @you into a link that receives Ethereum, Solana and Bitcoin. One signature to set up.
          Nothing to install, nothing held for you.
        </p>
        <div
          id="claim"
          className="mx-auto mt-10 max-w-[560px] scroll-mt-28 animate-enter-slow text-left [animation-delay:180ms]"
        >
          <ClaimInput
            size="xl"
            suggestionsAlign="center"
            onStatusChange={(status, name) => setPreview(status === 'available' ? name : null)}
          />
        </div>
      </section>

      <section className="mx-auto flex w-full max-w-content justify-center overflow-x-clip px-6 pt-6">
        <IdentityCard name={preview ?? PREVIEW_NAME} />
      </section>
    </>
  );
}
