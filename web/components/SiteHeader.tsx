'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import { useDisconnect } from 'wagmi';
import { clearAuth } from '@/lib/auth';
import { useAuthState } from '@/lib/useAuthState';
import { isActivePath, resolveRoute } from '@/lib/routes';
import { useTheme } from './ThemeProvider';

const shortAddr = (addr: string) => `${addr.slice(0, 6)}…${addr.slice(-4)}`;

export function SiteHeader() {
  const pathname = usePathname() ?? '/';
  const route = resolveRoute(pathname);
  const { auth, hydrated, isSignedIn } = useAuthState();
  const { disconnect } = useDisconnect();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuId = useId();
  const headerRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  // Until we hydrate from localStorage, render the signed-out shape — this
  // matches the server render and avoids a hydration mismatch.
  const signedIn = hydrated && isSignedIn && !!auth;
  const showSignIn = hydrated && !isSignedIn && !route.hideSignIn;
  const identity = auth ? (auth.username ? `@${auth.username}` : shortAddr(auth.wallet)) : '';

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setMenuOpen(false);
      menuButtonRef.current?.focus();
    };
    const onPointer = (e: PointerEvent) => {
      if (!headerRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    // The menu only exists at ≤820px; drop it if the viewport grows past that.
    const desktop = window.matchMedia('(min-width: 821px)');
    const onResize = (e: MediaQueryListEvent) => {
      if (e.matches) setMenuOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    desktop.addEventListener('change', onResize);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
      desktop.removeEventListener('change', onResize);
    };
  }, [menuOpen]);

  const handleSignOut = () => {
    clearAuth();
    try {
      disconnect();
    } catch {
      // wagmi may not be ready in some edge cases — clearAuth alone is enough
    }
    setMenuOpen(false);
  };

  return (
    <header ref={headerRef} className="sticky top-0 z-30 px-5 py-3.5">
      <div className="mx-auto flex h-14 max-w-content items-center justify-between gap-3 rounded-pill border border-line bg-surface pl-[18px] pr-2.5">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/" className="flex shrink-0 items-center gap-2.5 rounded-pill text-ink">
            <span
              aria-hidden
              className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-full bg-accent font-display text-[17px] font-bold text-on-accent"
            >
              @
            </span>
            <span className="font-display text-[18px] font-semibold tracking-display max-[480px]:sr-only">
              paytag
            </span>
          </Link>
          {route.section && (
            <>
              <span aria-hidden className="text-[15px] text-ink3 max-[480px]:hidden">
                /
              </span>
              <span
                className="min-w-0 max-w-[220px] truncate text-sm font-semibold text-ink2 max-[480px]:hidden"
                title={route.section}
              >
                {route.section}
              </span>
            </>
          )}
        </div>

        <nav aria-label="Primary" className="flex gap-1 text-sm font-medium max-[820px]:hidden">
          {route.nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActivePath(item.href, pathname) ? 'page' : undefined}
              className="inline-flex min-h-10 shrink-0 items-center whitespace-nowrap rounded-pill px-3.5 text-ink2 transition-colors hover:bg-surface2 hover:text-ink"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex shrink-0 items-center gap-1.5">
          {showSignIn && (
            <Link
              href="/app"
              className="inline-flex min-h-10 items-center px-3.5 text-sm font-medium text-ink2 transition-colors hover:text-ink max-[820px]:hidden"
            >
              Sign in
            </Link>
          )}

          {signedIn && (
            <Link
              href="/app"
              title={auth.username ? `Signed in as @${auth.username}` : `Signed in · ${auth.wallet}`}
              // The chip is 34px tall to match the design; the ::before
              // extends the hit area to 40px without changing its look.
              className="relative inline-flex max-w-[180px] items-center gap-2 whitespace-nowrap rounded-pill border border-line py-[7px] pl-2.5 pr-3 font-mono text-[13px] font-semibold text-ink transition-colors before:absolute before:-inset-y-[3px] before:inset-x-0 before:content-[''] hover:border-line2 max-[820px]:hidden"
            >
              <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-ok" />
              <span className="truncate">{identity}</span>
            </Link>
          )}

          {route.cta && (
            <Link
              href={route.cta.href}
              className="inline-flex min-h-10 items-center whitespace-nowrap rounded-pill bg-btn px-[18px] text-sm font-bold text-on-btn transition-colors hover:bg-accent hover:text-on-accent"
            >
              {route.cta.label}
            </Link>
          )}

          <ThemeToggle />

          <button
            ref={menuButtonRef}
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            aria-controls={menuId}
            className="hidden h-10 w-10 flex-col items-center justify-center gap-[5px] rounded-full border border-line text-ink transition-colors hover:border-line2 max-[820px]:inline-flex"
          >
            <span aria-hidden className="block h-0.5 w-4 rounded-full bg-current" />
            <span aria-hidden className="block h-0.5 w-4 rounded-full bg-current" />
          </button>
        </div>
      </div>

      {menuOpen && (
        <div id={menuId} className="absolute inset-x-5 top-[calc(100%-6px)]">
          <div className="mx-auto grid max-w-content animate-stage gap-1 rounded-card border border-line bg-surface p-2.5 text-base font-semibold shadow-float">
            {route.nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMenuOpen(false)}
                aria-current={isActivePath(item.href, pathname) ? 'page' : undefined}
                className="flex min-h-11 items-center rounded-inset-sm px-4 py-3.5 text-ink transition-colors hover:bg-surface2"
              >
                {item.label}
              </Link>
            ))}
            {(signedIn || showSignIn) && <div aria-hidden className="mx-2 my-1.5 h-px bg-line" />}
            {signedIn && (
              <div className="flex min-h-11 items-center justify-between gap-3 px-4 py-2.5">
                <span className="truncate font-mono text-sm text-ink2">{identity}</span>
                <button
                  type="button"
                  onClick={handleSignOut}
                  className="inline-flex min-h-10 shrink-0 items-center text-sm text-danger"
                >
                  Sign out
                </button>
              </div>
            )}
            {showSignIn && (
              <Link
                href="/app"
                onClick={() => setMenuOpen(false)}
                className="flex min-h-11 items-center rounded-inset-sm px-4 py-3.5 text-ink2 transition-colors hover:bg-surface2"
              >
                Sign in
              </Link>
            )}
          </div>
        </div>
      )}
    </header>
  );
}

function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const label = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={label}
      title={label}
      className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-line text-ink2 transition-colors hover:border-line2 hover:text-ink"
    >
      {/* Glyph is styled from [data-theme] in globals.css so it's correct on first paint. */}
      <span aria-hidden className="theme-dot h-3.5 w-3.5 rounded-full" />
    </button>
  );
}
