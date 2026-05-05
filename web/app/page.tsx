import Link from 'next/link';
import { UsernameClaimInput } from '@/components/UsernameClaimInput';
import { GradientMesh } from '@/components/GradientMesh';
import { CodeCard } from '@/components/CodeCard';
import { ChainGlyph } from '@/components/ChainGlyph';

export default function HomePage() {
  return (
    <>
      {/* === Hero === */}
      <section className="relative overflow-hidden">
        <GradientMesh />
        <div className="relative max-w-[1240px] mx-auto px-6 md:px-10 pt-16 md:pt-24 pb-20 md:pb-28">
          <div className="max-w-3xl animate-rise rise-1">
            <div className="inline-flex items-center gap-2 bg-white/70 backdrop-blur border border-hairline rounded-full px-3 py-1.5 mb-7 text-xs font-semibold text-ink-2">
              <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
              <span>Now in public beta — names are first-come, first-served</span>
            </div>
            <h1 className="font-display font-bold text-[40px] sm:text-[64px] lg:text-[88px] leading-[0.95] tracking-tightest text-ink">
              Money has a{' '}
              <span
                className="inline-block bg-clip-text text-transparent"
                style={{
                  backgroundImage:
                    'linear-gradient(110deg, #5469D4 0%, #7E5CFF 35%, #FF5A6E 75%, #FFB547 100%)',
                }}
              >
                name
              </span>{' '}
              now.
            </h1>
            <p className="mt-6 text-lg md:text-xl text-ink-2 max-w-xl leading-relaxed animate-rise rise-2">
              Replace long wallet addresses with a single @username. Paytag resolves to
              your wallets across Ethereum, Solana, and Bitcoin — share one link, get
              paid anywhere.
            </p>
          </div>

          {/* Claim widget */}
          <div
            id="claim"
            className="mt-12 max-w-2xl card p-6 md:p-7 animate-rise rise-3 backdrop-blur-md bg-white/95"
          >
            <div className="eyebrow mb-3">Reserve your name</div>
            <UsernameClaimInput />
          </div>

          {/* Trust row */}
          <div className="mt-12 flex flex-wrap items-center gap-x-10 gap-y-4 text-sm text-ink-3 animate-rise rise-4">
            <div className="flex items-center gap-2">
              <ChainGlyph chain="ethereum" size={22} />
              <span>Ethereum</span>
            </div>
            <div className="flex items-center gap-2">
              <ChainGlyph chain="solana" size={22} />
              <span>Solana</span>
            </div>
            <div className="flex items-center gap-2">
              <ChainGlyph chain="bitcoin" size={22} />
              <span>Bitcoin</span>
            </div>
            <span className="text-ink-4">·</span>
            <span>One signature. No password. No email.</span>
          </div>
        </div>
      </section>

      {/* === How it works === */}
      <section className="relative section-tint py-20 md:py-28 border-y border-hairline">
        <div className="max-w-[1240px] mx-auto px-6 md:px-10">
          <div className="max-w-3xl mb-14">
            <div className="eyebrow mb-3">How it works</div>
            <h2 className="font-display font-bold text-3xl md:text-5xl tracking-tightish text-ink leading-tight">
              From wallet address to <span className="text-primary">@yourname</span> in
              about 30 seconds.
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {STEPS.map((s, i) => (
              <div key={s.t} className="card card-hover p-7">
                <div
                  className="w-11 h-11 rounded-xl flex items-center justify-center mb-5 text-white font-bold"
                  style={{ background: s.bg, boxShadow: `0 8px 16px -4px ${s.shadow}` }}
                >
                  <span className="font-mono text-sm numeric">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                </div>
                <h3 className="text-xl font-semibold text-ink mb-2">{s.t}</h3>
                <p className="text-ink-2 leading-relaxed">{s.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* === Developer / dark band === */}
      <section
        id="developers"
        className="relative overflow-hidden py-20 md:py-28"
        style={{
          background:
            'linear-gradient(180deg, #0A2540 0%, #0F2C4F 45%, #0A2540 100%)',
        }}
      >
        {/* subtle blobs in the dark section */}
        <div
          aria-hidden
          className="absolute -top-40 -left-40 w-[40rem] h-[40rem] rounded-full opacity-30 blur-3xl"
          style={{ background: '#5469D4' }}
        />
        <div
          aria-hidden
          className="absolute -bottom-40 -right-40 w-[36rem] h-[36rem] rounded-full opacity-30 blur-3xl"
          style={{ background: '#7E5CFF' }}
        />
        <div className="relative max-w-[1240px] mx-auto px-6 md:px-10 grid grid-cols-1 md:grid-cols-12 gap-10 md:gap-16 items-center">
          <div className="md:col-span-5 text-white">
            <div
              className="text-[11.5px] font-bold uppercase tracking-eyebrow mb-3"
              style={{ color: '#7AA8FF' }}
            >
              For developers
            </div>
            <h2 className="font-display font-bold text-3xl md:text-5xl leading-[1.05] tracking-tightish">
              Resolve a name. <span style={{ color: '#7E5CFF' }}>One call.</span>
            </h2>
            <p className="mt-5 text-white/70 text-lg leading-relaxed max-w-md">
              A TypeScript-first SDK over a predictable JSON API. Stable error codes,
              a 30-second edge cache, and zero config — drop it into a wallet, payment
              app, or invoice tool anywhere a wallet address would otherwise be.
            </p>
            <div className="mt-8 grid grid-cols-3 gap-4 max-w-md">
              {[
                { v: '<100', l: 'ms p95' },
                { v: '3', l: 'chains' },
                { v: '0$', l: 'to use' },
              ].map((s) => (
                <div key={s.l} className="border-l-2 border-white/15 pl-4">
                  <div className="font-display font-bold text-3xl text-white numeric">
                    {s.v}
                  </div>
                  <div
                    className="mt-1 text-[10.5px] font-bold uppercase tracking-eyebrow"
                    style={{ color: '#8CA8D5' }}
                  >
                    {s.l}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link
                href="#claim"
                className="btn-primary"
                style={{ boxShadow: '0 8px 24px -4px rgba(84,105,212,0.5)' }}
              >
                <span>Reserve your name</span>
                <span aria-hidden>→</span>
              </Link>
              <a
                href="https://www.npmjs.com/package/@paytagdev/sdk"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm text-white/70 hover:text-white transition-colors"
              >
                View on npm
                <span aria-hidden>→</span>
              </a>
              <a
                href="https://api.paytag.dev/health"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm text-white/70 hover:text-white transition-colors"
              >
                API status
                <span aria-hidden>→</span>
              </a>
            </div>
          </div>

          <div className="md:col-span-7">
            <div className="mb-3 inline-flex items-center gap-2 font-mono text-[12px] text-white/70 bg-white/5 border border-white/10 rounded-md px-3 py-1.5">
              <span className="text-white/40">$</span>
              <span>npm install @paytagdev/sdk</span>
            </div>
            <CodeCard tab="resolve.ts" status="200 OK · 38 ms" />
            <div className="mt-4 flex flex-wrap gap-2">
              {[
                'Zero config',
                'Stable error codes',
                'Edge cached',
                'TypeScript-first',
              ].map((t) => (
                <span
                  key={t}
                  className="text-[12px] font-semibold px-3 py-1.5 rounded-full text-white/80 border border-white/10 bg-white/5"
                >
                  {t}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* === Feature grid === */}
      <section className="py-20 md:py-28">
        <div className="max-w-[1240px] mx-auto px-6 md:px-10">
          <div className="max-w-2xl mb-14">
            <div className="eyebrow mb-3">Why paytag</div>
            <h2 className="font-display font-bold text-3xl md:text-5xl tracking-tightish text-ink leading-tight">
              Designed to <span className="text-primary">disappear</span> behind the
              experience.
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {FEATURES.map((f) => (
              <div
                key={f.t}
                className="card card-hover p-7 relative overflow-hidden"
              >
                <div
                  aria-hidden
                  className="absolute -right-12 -top-12 w-44 h-44 rounded-full blur-2xl"
                  style={{ background: f.glow, opacity: 0.18 }}
                />
                <div className="relative">
                  <div className="text-2xl mb-4 numeric font-mono text-ink-3">
                    {f.icon}
                  </div>
                  <h3 className="text-lg font-semibold text-ink mb-2">{f.t}</h3>
                  <p className="text-ink-2 leading-relaxed text-[15px]">{f.d}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* === Final CTA === */}
      <section className="relative overflow-hidden">
        <GradientMesh intensity="bold" />
        <div className="relative max-w-[1240px] mx-auto px-6 md:px-10 py-24 md:py-32 text-center">
          <div className="inline-block bg-white/70 backdrop-blur border border-hairline rounded-full px-3 py-1.5 mb-7 text-xs font-semibold text-ink-2">
            Names are first-come, first-served
          </div>
          <h2 className="font-display font-bold text-4xl md:text-6xl tracking-tightest text-ink max-w-3xl mx-auto leading-[1.05]">
            Reserve your <span className="text-primary">@name</span> while it&apos;s still
            yours to take.
          </h2>
          <div className="mt-10 max-w-2xl mx-auto card p-6 md:p-7 backdrop-blur-md bg-white/95 text-left">
            <UsernameClaimInput />
          </div>
        </div>
      </section>
    </>
  );
}

const STEPS = [
  {
    t: 'Pick a name',
    d: 'Type the @name you want. Live availability checks tell you instantly if it’s free, with smart suggestions when it isn’t.',
    bg: 'linear-gradient(135deg, #5469D4 0%, #7E5CFF 100%)',
    shadow: 'rgba(84,105,212,0.45)',
  },
  {
    t: 'Sign once',
    d: 'A single message signature proves the wallet is yours. No transaction. No gas. No password to forget later.',
    bg: 'linear-gradient(135deg, #00D4FF 0%, #5469D4 100%)',
    shadow: 'rgba(0,212,255,0.4)',
  },
  {
    t: 'Get paid',
    d: 'Share paytag.io/yourname. Anyone can send you crypto with one link — no install, no extension, no copy-paste.',
    bg: 'linear-gradient(135deg, #FF5A6E 0%, #FFB547 100%)',
    shadow: 'rgba(255,90,110,0.4)',
  },
];

const FEATURES = [
  {
    icon: '@01',
    t: 'One name across chains',
    d: 'Map @yourname to your Ethereum, Solana, and Bitcoin wallets. Senders pick the chain — you keep one identity.',
    glow: '#5469D4',
  },
  {
    icon: '@02',
    t: 'No custody, no keys held',
    d: 'Paytag never touches your private keys. Authentication is a single message signature; payments stay in your wallet.',
    glow: '#7E5CFF',
  },
  {
    icon: '@03',
    t: 'Built for builders',
    d: 'A clean JSON resolver behind a stable contract. Drop it into wallets, payment flows, or invoice tools in minutes.',
    glow: '#FF5A6E',
  },
];
