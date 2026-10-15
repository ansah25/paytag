export interface NavItem {
  href: string;
  label: string;
}

export type RouteKind = 'landing' | 'send' | 'dashboard' | 'claim' | 'profile' | 'onchain' | 'other';

export interface RouteContext {
  kind: RouteKind;
  /** Text after the "/" next to the wordmark. */
  section: string | null;
  nav: NavItem[];
  cta: NavItem | null;
  /** /app renders its own connect gate, so the header doesn't offer "Sign in". */
  hideSignIn: boolean;
}

const HOME: NavItem = { href: '/', label: 'Home' };
const SEND: NavItem = { href: '/send', label: 'Send' };
const DASHBOARD: NavItem = { href: '/app', label: 'Dashboard' };
const DEVELOPERS: NavItem = { href: '/#developers', label: 'Developers' };
const CLAIM_A_NAME: NavItem = { href: '/#claim', label: 'Claim a name' };
const ONCHAIN: NavItem = { href: '/on-chain', label: 'On-chain' };
const MANAGE_ONCHAIN: NavItem = { href: '/on-chain/my-names', label: 'My names' };

// First path segments owned by real routes. Any other single segment is a
// public profile at /[username]. `on-chain` can never be a username (no hyphens allowed).
// `status` is reserved off-chain by the API (ROUTE_RESERVED_USERNAMES) so no profile can sit under it.
const STATIC_SEGMENTS = new Set(['send', 'app', 'claim', 'welcome', 'pay', 'ui-kit', 'on-chain', 'status']);

export function resolveRoute(pathname: string): RouteContext {
  const segments = pathname.toLowerCase().split('/').filter(Boolean);
  const [first, second] = segments;

  if (!first) {
    return { kind: 'landing', section: null, nav: [SEND, ONCHAIN, DEVELOPERS], cta: CLAIM_A_NAME, hideSignIn: false };
  }
  if (first === 'on-chain') {
    // Static sub-routes contain a hyphen ("my-names"), which no on-chain name can, so they can
    // never shadow a name's page at /on-chain/[name].
    // The on-chain section has its own wallet connect; the off-chain "Sign in" doesn't apply.
    return {
      kind: 'onchain',
      section: second === 'my-names' ? 'On-chain · My names' : second ? `On-chain · @${second}` : 'On-chain',
      nav: second === 'my-names' ? [ONCHAIN, HOME] : [MANAGE_ONCHAIN, HOME],
      cta: second === 'my-names' ? { href: '/on-chain', label: 'Register a name' } : null,
      hideSignIn: true,
    };
  }
  if (first === 'status') {
    return { kind: 'other', section: 'Status', nav: [ONCHAIN, HOME], cta: CLAIM_A_NAME, hideSignIn: false };
  }
  if (first === 'send') {
    return { kind: 'send', section: 'Send', nav: [DASHBOARD, HOME], cta: CLAIM_A_NAME, hideSignIn: false };
  }
  if (first === 'app') {
    return {
      kind: 'dashboard',
      section: 'Dashboard',
      nav: [SEND, HOME],
      cta: { href: '/send', label: 'Send money' },
      hideSignIn: true,
    };
  }
  if (first === 'claim' || first === 'welcome') {
    return {
      kind: 'claim',
      section: first === 'claim' && second ? `Claim @${second}` : 'Claim',
      nav: [HOME],
      cta: { href: '/#claim', label: 'Choose another name' },
      hideSignIn: false,
    };
  }
  if (segments.length === 1 && !STATIC_SEGMENTS.has(first)) {
    return {
      kind: 'profile',
      section: `@${first}`,
      nav: [SEND, HOME],
      cta: { href: '/#claim', label: 'Claim your name' },
      hideSignIn: false,
    };
  }
  return { kind: 'other', section: null, nav: [SEND, HOME], cta: CLAIM_A_NAME, hideSignIn: false };
}

export function isActivePath(href: string, pathname: string): boolean {
  if (href.includes('#')) return false;
  const path = pathname.toLowerCase();
  if (href === '/') return path === '/';
  return path === href || path.startsWith(`${href}/`);
}
