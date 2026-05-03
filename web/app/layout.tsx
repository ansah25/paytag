import type { Metadata } from 'next';
import './globals.css';
import { Providers } from './providers';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Paytag',
  description: 'Username-to-wallet identity for multi-chain crypto payments',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <header className="border-b border-border">
            <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
              <Link href="/" className="font-semibold tracking-tight text-lg">
                paytag
              </Link>
              <nav className="text-sm text-muted flex gap-6">
                <Link href="/" className="hover:text-white">Resolve</Link>
                <Link href="/app" className="hover:text-white">Manage</Link>
              </nav>
            </div>
          </header>
          <main className="max-w-5xl mx-auto px-6 py-10">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
