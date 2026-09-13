import type { ReactNode } from 'react';
import { Button } from './ui/Button';

type Action = { label: string; href: string } | { label: string; onClick: () => void };

interface Props {
  kicker: string;
  tone?: 'danger' | 'muted';
  title: string;
  copy: ReactNode;
  primary: Action;
  footnote?: ReactNode;
}

/** Centered full-page message: 404, route errors, unknown @name. */
export function MessageScreen({ kicker, tone = 'danger', title, copy, primary, footnote }: Props) {
  return (
    <section className="mx-auto flex w-full max-w-content justify-center px-6 pb-24 pt-[clamp(48px,10vh,120px)]">
      <div className="grid w-full max-w-[520px] animate-enter justify-items-center gap-[18px] text-center">
        <div
          className={`font-mono text-[13px] uppercase tracking-kicker ${
            tone === 'danger' ? 'text-danger' : 'text-ink3'
          }`}
        >
          {kicker}
        </div>
        <h1 className="break-words font-display text-[clamp(36px,5vw,60px)] font-semibold leading-none tracking-display-lg [text-wrap:balance]">
          {title}
        </h1>
        <p className="max-w-[420px] text-base leading-[1.55] text-ink2 [text-wrap:pretty]">{copy}</p>
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          {'href' in primary ? (
            <Button size={48} href={primary.href}>
              {primary.label}
            </Button>
          ) : (
            <Button size={48} onClick={primary.onClick}>
              {primary.label}
            </Button>
          )}
          <Button size={48} variant="outline" href="/">
            Back home
          </Button>
        </div>
        {footnote && <div className="mt-3 font-mono text-xs text-ink3">{footnote}</div>}
      </div>
    </section>
  );
}
