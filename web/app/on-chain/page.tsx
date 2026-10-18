import type { Metadata } from 'next';
import { LookupPanel } from '@/components/onchain/LookupPanel';
import { RegisterPanel } from '@/components/onchain/RegisterPanel';

export const metadata: Metadata = {
  title: 'On-chain names · Paytag',
  description: 'Register and resolve Paytag names on the Base registry.',
};

export default function OnchainPage({ searchParams }: { searchParams: { name?: string | string[] } }) {
  // ?name= prefills the form (the dashboard links here with the account's name).
  const initialName = typeof searchParams.name === 'string' ? searchParams.name.slice(0, 21) : '';
  return (
    <section className="mx-auto grid w-full max-w-content gap-7 px-6 pb-24 pt-12">
      <div className="animate-enter">
        <h1 className="font-display text-[clamp(32px,4.5vw,52px)] font-semibold leading-none tracking-display-lg">
          Your name, on-chain.
        </h1>
        <p className="mt-3 max-w-[560px] text-[15px] leading-[1.55] text-ink2">
          Paytag names on Base are owned by your wallet, not by us. One name points at your addresses on every chain;
          anyone can resolve it without an account.
        </p>
      </div>
      <RegisterPanel initialName={initialName} />
      <LookupPanel />
    </section>
  );
}
