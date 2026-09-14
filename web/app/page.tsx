import { ClaimInput } from '@/components/ClaimInput';
import { CodeCard } from '@/components/CodeCard';
import { LandingHero } from '@/components/landing/LandingHero';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';

const SDK_DOCS_URL = 'https://github.com/ansah25/paytag/tree/main/packages/sdk#readme';
const NPM_URL = 'https://www.npmjs.com/package/@paytagdev/sdk';

const STEPS = [
  {
    title: 'Pick a name',
    copy: 'We check availability as you type and suggest alternatives if it’s taken.',
  },
  {
    title: 'Sign once',
    copy: 'A message signature proves the wallet is yours. No gas, no transaction, no password.',
  },
  {
    title: 'Share your link',
    copy: 'Anyone can open paytag.dev/you, pick a chain and pay from their own wallet.',
  },
];

const DEV_STATS = [
  { value: '<100ms', label: 'p95 resolve' },
  { value: '3', label: 'chains' },
  { value: 'Free', label: 'to use' },
];

const FEATURES = [
  {
    title: 'One name, every chain',
    copy: 'Senders choose the network. You keep a single identity.',
  },
  {
    title: 'Nothing held for you',
    copy: 'Only public addresses are stored. Payments go wallet to wallet.',
  },
  {
    title: 'Stable for builders',
    copy: 'A versioned resolver with typed errors that fits inside wallets and checkouts.',
  },
];

export default function HomePage() {
  return (
    <>
      <LandingHero />

      <section aria-labelledby="how-title" className="mx-auto w-full max-w-content px-6 pt-24">
        <h2 id="how-title" className="sr-only">
          How it works
        </h2>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(260px,100%),1fr))] gap-4">
          {STEPS.map((step, i) => (
            <Card
              key={step.title}
              as="article"
              padding="none"
              className="flex min-h-[240px] flex-col justify-between gap-8 p-8"
            >
              <span className="font-display text-[15px] font-semibold text-accent">Step {i + 1}</span>
              <div>
                <h3 className="mb-2.5 font-display text-[26px] font-semibold tracking-display-md">{step.title}</h3>
                <p className="text-base leading-[1.55] text-ink2 [text-wrap:pretty]">{step.copy}</p>
              </div>
            </Card>
          ))}
        </div>
      </section>

      <section id="developers" aria-labelledby="developers-title" className="mx-auto w-full max-w-content scroll-mt-28 px-6 pt-24">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(300px,100%),1fr))] items-center gap-10 rounded-panel border border-line bg-surface p-[clamp(24px,4vw,48px)]">
          <div className="min-w-0">
            <span className="font-display text-[15px] font-semibold text-accent">For developers</span>
            <h2
              id="developers-title"
              className="mt-3.5 font-display text-[clamp(32px,4vw,48px)] font-semibold leading-[1.02] tracking-display-lg [text-wrap:balance]"
            >
              Resolve a name in one call.
            </h2>
            <p className="mt-[18px] text-base leading-[1.55] text-ink2 [text-wrap:pretty]">
              A TypeScript SDK over a plain JSON API. Stable error codes, 30-second edge cache, zero config. Fits
              wherever an address field used to be.
            </p>
            <div className="mt-7 flex flex-wrap gap-7">
              {DEV_STATS.map((stat) => (
                <div key={stat.label}>
                  <div className="font-display text-[30px] font-semibold tracking-display-md">{stat.value}</div>
                  <div className="text-[13px] text-ink2">{stat.label}</div>
                </div>
              ))}
            </div>
            <div className="mt-7 flex flex-wrap gap-2">
              <Button variant="solid" href={SDK_DOCS_URL}>
                Read the docs
              </Button>
              <Button variant="outline" href={NPM_URL}>
                View on npm
              </Button>
            </div>
          </div>
          <CodeCard />
        </div>
      </section>

      <section aria-labelledby="features-title" className="mx-auto w-full max-w-content px-6 pt-24">
        <h2
          id="features-title"
          className="mb-10 max-w-[600px] font-display text-[clamp(32px,4vw,48px)] font-semibold leading-[1.02] tracking-display-lg [text-wrap:balance]"
        >
          Built to disappear behind the payment.
        </h2>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(240px,100%),1fr))] gap-4">
          {FEATURES.map((feature) => (
            <div key={feature.title} className="border-t border-line2 pt-5">
              <h3 className="mb-2 text-[17px] font-bold">{feature.title}</h3>
              <p className="text-[15px] leading-[1.55] text-ink2">{feature.copy}</p>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="cta-title" className="mx-auto w-full max-w-content px-6 pb-24 pt-28 text-center">
        <h2
          id="cta-title"
          className="mx-auto max-w-[720px] font-display text-[clamp(36px,5.5vw,72px)] font-semibold leading-[0.98] tracking-display-lg [text-wrap:balance]"
        >
          Your name is probably still free.
        </h2>
        <div className="mx-auto mt-9 max-w-[520px] text-left">
          <ClaimInput size="lg" suggestionsAlign="center" />
        </div>
      </section>
    </>
  );
}
