'use client';

import { usePathname } from 'next/navigation';
import { resolveRoute } from '@/lib/routes';

const LINKS = [
  { label: 'Docs', href: 'https://github.com/ansah25/paytag/tree/main/packages/sdk#readme' },
  { label: 'Status', href: 'https://api.paytag.dev/health' },
  { label: 'GitHub', href: 'https://github.com/ansah25/paytag' },
  // TODO: add "Terms" once a terms page exists (spec: Docs · Status · GitHub · Terms).
];

export function SiteFooter() {
  const pathname = usePathname() ?? '/';
  const { kind } = resolveRoute(pathname);

  return (
    <footer className="mt-auto px-6 pb-8">
      <div className="mx-auto flex max-w-content flex-wrap justify-between gap-5 border-t border-line pt-7 text-[13px] text-ink2">
        <span className="font-display text-[15px] font-semibold text-ink">paytag</span>
        {kind === 'profile' ? (
          <span>Non-custodial · payments go wallet to wallet</span>
        ) : (
          <>
            <nav aria-label="Footer" className="flex flex-wrap gap-6 font-medium">
              {LINKS.map((link) => (
                <a
                  key={link.label}
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  // Negative margin keeps the design's line height while giving a 40px hit area.
                  className="-my-2.5 py-2.5 text-ink2 transition-colors hover:text-ink"
                >
                  {link.label}
                </a>
              ))}
            </nav>
            <span>© {new Date().getFullYear()} · Non-custodial</span>
          </>
        )}
      </div>
    </footer>
  );
}
