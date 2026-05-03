import Link from 'next/link';
import { ResolveSearch } from '@/components/ResolveSearch';

export default function HomePage() {
  return (
    <div className="space-y-10">
      <section className="space-y-3 max-w-2xl">
        <h1 className="text-4xl font-semibold tracking-tight">
          One username. Every chain.
        </h1>
        <p className="text-muted text-lg">
          Paytag maps human-readable usernames to wallet addresses across Ethereum, Solana, and
          Bitcoin. Look up any registered username below.
        </p>
      </section>

      <ResolveSearch />

      <div className="text-sm text-muted">
        Have a wallet?{' '}
        <Link href="/app" className="text-accent hover:underline">
          Register your username →
        </Link>
      </div>
    </div>
  );
}
