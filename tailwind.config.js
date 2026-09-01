/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        paper: 'var(--paper)', card: 'var(--card)', ink: 'var(--ink)', soft: 'var(--soft)',
        plum: 'var(--plum)', rose: 'var(--rose)', sage: 'var(--sage)', amber: 'var(--amber)',
        rule: 'var(--rule)', shade: 'var(--shade)', nav: 'var(--nav)',
        ok: 'var(--ok)', warn: 'var(--warn)', bad: 'var(--bad)',
      },
      fontFamily: {
        sans: ['Heebo', 'system-ui', 'sans-serif'],
        display: ['"Frank Ruhl Libre"', 'Georgia', 'serif'],
      },
      borderRadius: { card: '10px', field: '7px', btn: '8px' },
      boxShadow: { pop: '0 8px 24px rgba(36,26,46,.10)' },
      screens: { md: '860px' },
    },
  },
  plugins: [],
};
