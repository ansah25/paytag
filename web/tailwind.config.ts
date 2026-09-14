import type { Config } from 'tailwindcss';

// Colors, radii, shadows and fonts are *replaced* (not extended) so only the
// design-system values exist as classes. Every color points at a CSS variable
// defined in app/globals.css, so the same class works in both themes.
// Note: opacity modifiers (`bg-accent/10`) don't apply to var() colors — use
// the dedicated `*-bg` tokens instead.
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      inherit: 'inherit',
      bg: 'var(--bg)',
      surface: 'var(--surface)',
      surface2: 'var(--surface2)',
      line: 'var(--line)',
      line2: 'var(--line2)',
      ink: 'var(--ink)',
      ink2: 'var(--ink2)',
      ink3: 'var(--ink3)',
      accent: 'var(--accent)',
      'on-accent': 'var(--on-accent)',
      ok: 'var(--ok)',
      'ok-bg': 'var(--ok-bg)',
      warn: 'var(--warn)',
      'warn-bg': 'var(--warn-bg)',
      danger: 'var(--danger)',
      'danger-bg': 'var(--danger-bg)',
      btn: 'var(--btn)',
      'on-btn': 'var(--on-btn)',
      // Chain dots only — theme-independent, never used for text.
      eth: '#627EEA',
      sol: '#9945FF',
      btc: '#F7931A',
    },
    fontFamily: {
      display: ['var(--font-display)', 'system-ui', 'sans-serif'],
      sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
      mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'monospace'],
    },
    borderRadius: {
      none: '0',
      full: '9999px',
      pill: '999px',
      card: '24px',
      panel: '28px',
      'inset-sm': '14px',
      inset: '16px',
      'inset-lg': '18px',
      'inset-xl': '20px',
    },
    boxShadow: {
      none: 'none',
      float: 'var(--shadow)',
      tab: '0 1px 2px rgba(0,0,0,0.2)',
    },
    // Keyframes live in app/globals.css; emptying this stops Tailwind emitting
    // its own `spin`/`pulse` keyframes over ours.
    keyframes: {},
    animation: {
      none: 'none',
      enter: 'rise 0.5s ease-out both',
      'enter-slow': 'rise 0.7s ease-out both',
      stage: 'stage 0.3s ease-out both',
      toast: 'toastIn 0.25s ease-out both',
      spin: 'spin 0.8s linear infinite',
      shimmer: 'shimmer 1.6s ease-in-out infinite',
      pulse: 'pulse 1.2s ease-in-out infinite',
      float: 'float 7s ease-in-out infinite',
    },
    extend: {
      letterSpacing: {
        display: '-0.02em',
        'display-md': '-0.03em',
        'display-lg': '-0.04em',
        label: '0.06em',
        kicker: '0.08em',
      },
      maxWidth: {
        content: '1120px',
      },
    },
  },
  plugins: [],
};

export default config;
