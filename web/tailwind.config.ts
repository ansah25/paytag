import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Surfaces
        canvas: '#FFFFFF',
        paper: '#F6F9FC',          // very subtle blue-tint for sections
        panel: '#FFFFFF',
        midnight: '#0A2540',        // deep navy for code sections + hero text
        'midnight-2': '#0F2C4F',
        ink: '#0A2540',             // primary text = same deep navy
        'ink-2': '#425466',
        'ink-3': '#697386',
        'ink-4': '#8898AA',
        hairline: '#E3E8EE',
        'hairline-2': '#CFD7DF',
        // Accent system (used across pages — distinct from Stripe's purple-blue)
        primary: '#5469D4',
        'primary-2': '#4358CB',
        'primary-soft': '#EEF1FF',
        accent: '#7E5CFF',
        coral: '#FF5A6E',
        cyan: '#00D4FF',
        amber: '#FFB547',
        success: '#13BC8C',
        danger: '#E5424D',
      },
      fontFamily: {
        display: ['var(--font-display)', 'ui-serif', 'system-ui', 'sans-serif'],
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      letterSpacing: {
        tightest: '-0.04em',
        tightish: '-0.022em',
        eyebrow: '0.16em',
      },
      fontSize: {
        eyebrow: ['0.6875rem', { lineHeight: '1rem', letterSpacing: '0.16em' }],
        'display-xl': ['6.5rem', { lineHeight: '0.95', letterSpacing: '-0.04em' }],
        'display-l': ['4.5rem', { lineHeight: '0.98', letterSpacing: '-0.035em' }],
        'display-m': ['3rem', { lineHeight: '1.05', letterSpacing: '-0.025em' }],
      },
      boxShadow: {
        soft: '0 1px 2px rgba(15,42,77,0.04), 0 4px 14px -4px rgba(15,42,77,0.06)',
        lift: '0 4px 6px -1px rgba(15,42,77,0.06), 0 12px 32px -8px rgba(15,42,77,0.12)',
        ring: '0 0 0 4px rgba(84,105,212,0.18)',
      },
      borderRadius: {
        '2xl': '1.25rem',
      },
      keyframes: {
        rise: {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        rise: 'rise 600ms cubic-bezier(0.2, 0.8, 0.2, 1) both',
      },
    },
  },
  plugins: [],
};

export default config;
