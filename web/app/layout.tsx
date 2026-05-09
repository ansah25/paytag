import type { Metadata } from 'next';
import { Cabin, Cabin_Condensed, JetBrains_Mono } from 'next/font/google';
import Link from 'next/link';
import './globals.css';
import { Providers } from './providers';
import { SiteHeader } from '@/components/SiteHeader';
import { AmbientBackdrop } from '@/components/AmbientBackdrop';

const cabin = Cabin({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-sans',
});

const cabinCondensed = Cabin_Condensed({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  display: 'swap',
  variable: '--font-display',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  display: 'swap',
  variable: '--font-mono',
});

export const metadata: Metadata = {
  title: 'Paytag — Money has a name now',
  description:
    'A username layer for crypto. Send and receive across Ethereum, Solana, and Bitcoin with a single @paytag.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${cabin.variable} ${cabinCondensed.variable} ${jetbrainsMono.variable}`}
    >
      <body>
        <AmbientBackdrop />
        <Providers>
          <div className="relative min-h-screen flex flex-col">
            <SiteHeader />
            <main className="flex-1">{children}</main>
            <SiteFooter />
          </div>
        </Providers>
      </body>
    </html>
  );
}

function Logo() {
  return (
    <span
      aria-hidden
      className="inline-flex items-center justify-center w-7 h-7 rounded-md text-white text-[14px] font-bold"
      style={{
        background: 'linear-gradient(135deg, #5469D4 0%, #7E5CFF 50%, #FF5A6E 100%)',
        boxShadow: '0 4px 12px -2px rgba(84,105,212,0.45)',
      }}
    >
      @
    </span>
  );
}

function SiteFooter() {
  return (
    <footer className="border-t border-hairline mt-32">
      <div className="max-w-[1240px] mx-auto px-6 md:px-10 py-12 grid grid-cols-2 md:grid-cols-4 gap-8 text-sm">
        <div className="col-span-2 md:col-span-2 max-w-sm">
          <div className="flex items-center gap-2 mb-3">
            <Logo />
            <span className="font-display font-bold text-[18px] text-ink">paytag</span>
          </div>
          <p className="text-ink-3">
            A username layer for crypto. One name. Every wallet. No more copy-paste.
          </p>
        </div>
        <div>
          <div className="eyebrow-muted mb-3">Product</div>
          <ul className="space-y-2 text-ink-2">
            <li><Link href="/" className="hover:text-primary">Home</Link></li>
            <li><Link href="/send" className="hover:text-primary">Send</Link></li>
            <li><Link href="/app" className="hover:text-primary">Dashboard</Link></li>
          </ul>
        </div>
        <div>
          <div className="eyebrow-muted mb-3">Build</div>
          <ul className="space-y-2 text-ink-2">
            <li><Link href="/#developers" className="hover:text-primary">API</Link></li>
            <li>
              <a
                href="https://www.npmjs.com/package/@paytagdev/sdk"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-primary"
              >
                SDK
              </a>
            </li>
            <li>
              <a
                href="https://api.paytag.dev/health"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-primary"
              >
                Status
              </a>
            </li>
          </ul>
        </div>
      </div>
      <div className="border-t border-hairline">
        <div className="max-w-[1240px] mx-auto px-6 md:px-10 py-5 flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between text-xs text-ink-4">
          <div>© {new Date().getFullYear()} Paytag. Money has a name now.</div>
          <div className="font-mono numeric">v0.1 · made for paying friends</div>
        </div>
      </div>
    </footer>
  );
}
