import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        paper: '#F6F9FC',
        ink: '#0A2540',
        'ink-2': '#425466',
        'ink-3': '#697386',
        'ink-4': '#8898AA',
        hairline: '#E3E8EE',
        primary: '#5469D4',
        'primary-soft': '#EEF1FF',
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
      boxShadow: {
        soft: '0 1px 2px rgba(15,42,77,0.04), 0 4px 14px -4px rgba(15,42,77,0.06)',
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
