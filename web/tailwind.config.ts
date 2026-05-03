import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0b0d12',
        panel: '#11141b',
        border: '#1f242e',
        accent: '#7c5cff',
        muted: '#7a8294',
      },
    },
  },
  plugins: [],
};

export default config;
