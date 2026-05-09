'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useDisconnect } from 'wagmi';
import { clearAuth } from '@/lib/auth';
import { useAuthState } from '@/lib/useAuthState';

type NavItem = { href: string; label: string };
type Cta = { href: string; label: string } | null;

const HOME: NavItem = { href: '/', label: 'Home' };
const SEND: NavItem = { href: '/send', label: 'Send' };
const DASHBOARD: NavItem = { href: '/app', label: 'Dashboard' };
const DEVELOPERS: NavItem = { href: '/#developers', label: 'Developers' };

interface RouteCtx {
  section: string | null;
  baseNav: NavItem[];
  signedOutCta: Cta;
  signedInCta: Cta;
  /** Hide the Sign in link even when signed-out (e.g. on /app the page handles it). */
  forceHideSignIn?: boolean;
}

function resolveRoute(pathname: string): RouteCtx {
  const path = pathname.toLowerCase();
  const segments = path.split('/').filter(Boolean);
  const first = segments[0] ?? '';

  if (path === '/') {
    return {
      section: null,
      baseNav: [SEND, DASHBOARD, DEVELOPERS],
      signedOutCta: { href: '/#claim', label: 'Claim a name' },
      signedInCta: { href: '/app', label: 'Open dashboard' },
    };
  }

  if (first === 'send') {
    return {
      section: 'Send',
      baseNav: [DASHBOARD, HOME],
      signedOutCta: { href: '/#claim', label: 'Claim a name' },
      // Already on /send — no extra CTA needed for signed-in users
      signedInCta: null,
    };
  }

  if (first === 'app') {
    return {
      section: 'Dashboard',
      baseNav: [SEND, HOME],
      signedOutCta: { href: '/send', label: 'Send money' },
      signedInCta: { href: '/send', label: 'Send money' },
      forceHideSignIn: true,
    };
  }

  if (first === 'welcome') {
    return {
      section: 'Welcome',
      baseNav: [DASHBOARD, SEND, HOME],
      signedOutCta: { href: '/app', label: 'Open dashboard' },
      signedInCta: { href: '/app', label: 'Open dashboard' },
      forceHideSignIn: true,
    };
  }

  if (first === 'claim') {
    const username = segments[1];
    return {
      section: username ? `Claim @${username}` : 'Claim',
      baseNav: [HOME],
      signedOutCta: { href: '/', label: 'Choose another' },
      signedInCta: { href: '/app', label: 'Open dashboard' },
    };
  }

  if (first === 'pay') {
    const username = segments[1];
    return {
      section: username ? `Pay @${username}` : 'Pay',
      baseNav: [SEND, HOME],
      signedOutCta: { href: '/#claim', label: 'Claim your name' },
      signedInCta: { href: '/app', label: 'Open dashboard' },
    };
  }

  // Public profile: /[username]
  return {
    section: `@${first}`,
    baseNav: [SEND, HOME],
    signedOutCta: { href: '/#claim', label: 'Claim your name' },
    signedInCta: { href: '/app', label: 'Open dashboard' },
  };
}

const shortAddr = (addr: string) => `${addr.slice(0, 6)}…${addr.slice(-4)}`;

export function SiteHeader() {
  const pathname = usePathname() ?? '/';
  const route = resolveRoute(pathname);
  const currentPath = pathname.toLowerCase();
  const { auth, hydrated, isSignedIn } = useAuthState();
  const { disconnect } = useDisconnect();

  // Until we hydrate from localStorage, render the signed-out shape — this
  // matches the server render and avoids a hydration mismatch.
  const treatAsSignedIn = hydrated && isSignedIn;

  const cta = treatAsSignedIn ? route.signedInCta : route.signedOutCta;
  const showSignInLink =
    !route.forceHideSignIn && hydrated && !isSignedIn;

  const handleSignOut = () => {
    clearAuth();
    try {
      disconnect();
    } catch {
      // wagmi may not be ready in some edge cases — clearAuth alone is enough
    }
  };

  return (
    <header className="sticky top-0 z-40 backdrop-blur-xl bg-white/20">
      <div className="max-w-[1240px] mx-auto px-6 md:px-10 h-16 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <Link href="/" className="flex items-center gap-2 group shrink-0">
            <Logo />
            <span className="font-display font-bold text-[19px] text-ink tracking-tightish">
              paytag
            </span>
          </Link>
          {route.section && (
            <>
              <span aria-hidden className="text-ink-4 select-none">
                /
              </span>
              <span
                className="font-display font-semibold text-[15px] text-ink-2 truncate max-w-[200px] sm:max-w-[320px]"
                title={route.section}
              >
                {route.section}
              </span>
            </>
          )}
        </div>

        <nav className="hidden md:flex items-center gap-1">
          {route.baseNav.map((item) => (
            <NavLink
              key={item.href}
              href={item.href}
              active={isActive(item.href, currentPath)}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="flex items-center gap-2 shrink-0">
          {showSignInLink && (
            <Link
              href="/app"
              className="inline-flex text-sm text-ink-2 hover:text-primary px-2 py-1.5 sm:px-3 font-medium transition-colors"
            >
              Sign in
            </Link>
          )}

          {treatAsSignedIn && auth && (
            <IdentityBadge
              username={auth.username}
              wallet={auth.wallet}
              onSignOut={handleSignOut}
            />
          )}

          {cta && (
            <Link href={cta.href} className="btn-primary">
              <span>{cta.label}</span>
              <span aria-hidden>→</span>
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}

function IdentityBadge({
  username,
  wallet,
  onSignOut,
}: {
  username?: string;
  wallet: string;
  onSignOut: () => void;
}) {
  const label = username ? `@${username}` : shortAddr(wallet);
  return (
    <div className="flex items-center gap-1">
      <Link
        href="/app"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-2 hover:text-primary px-2 py-1.5 sm:px-3 rounded-full border border-hairline bg-white/70 hover:border-primary/40 transition-colors max-w-[120px] sm:max-w-[180px] truncate"
        title={username ? `Signed in as @${username}` : `Signed in · ${wallet}`}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-success shrink-0" />
        <span className="font-mono numeric truncate">{label}</span>
      </Link>
      <button
        type="button"
        onClick={onSignOut}
        className="hidden sm:inline-flex text-xs text-ink-3 hover:text-danger px-2 py-1.5 font-medium transition-colors"
        aria-label="Sign out"
      >
        Sign out
      </button>
    </div>
  );
}

function isActive(href: string, currentPath: string): boolean {
  if (href.includes('#')) return false;
  if (href === '/') return currentPath === '/';
  return currentPath === href || currentPath.startsWith(`${href}/`);
}

function NavLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`px-3 py-2 text-sm font-medium transition-colors ${
        active ? 'text-primary' : 'text-ink-2 hover:text-primary'
      }`}
    >
      {children}
    </Link>
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
