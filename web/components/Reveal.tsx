'use client';

import { ReactNode } from 'react';
import { useInView } from '@/lib/useInView';

interface Props {
  children: ReactNode;
  className?: string;
  /** Optional ms delay layered on top of the base transition for staggering. */
  delay?: number;
}

// Thin client wrapper that fades + lifts its children into place when they
// scroll into view. Lets the rest of the page stay server-rendered.
export function Reveal({ children, className = '', delay }: Props) {
  const [ref, inView] = useInView<HTMLDivElement>();
  const style = delay ? { transitionDelay: `${delay}ms` } : undefined;
  return (
    <div
      ref={ref}
      style={style}
      className={`reveal ${inView ? 'is-visible' : ''} ${className}`}
    >
      {children}
    </div>
  );
}
