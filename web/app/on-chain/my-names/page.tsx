import type { Metadata } from 'next';
import { ManageNames } from '@/components/onchain/ManageNames';

export const metadata: Metadata = {
  title: 'My on-chain names · Paytag',
};

export default function ManagePage() {
  return (
    <section className="mx-auto grid w-full max-w-content gap-7 px-6 pb-24 pt-12">
      <div className="animate-enter">
        <h1 className="font-display text-[clamp(32px,4.5vw,52px)] font-semibold leading-none tracking-display-lg">My names</h1>
        <p className="mt-3 max-w-[560px] text-[15px] leading-[1.55] text-ink2">
          Point each name at your addresses, choose your primary name, or hand a name to someone else.
        </p>
      </div>
      <ManageNames />
    </section>
  );
}
