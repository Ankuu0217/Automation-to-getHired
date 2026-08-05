import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

/*
 * Class-level tokens for the "Bioluminescent laboratory" system.
 * Values must stay in sync with the CSS variables in src/index.css
 * (kept as literals here so Tailwind alpha modifiers like bg-lime/10 work).
 * Depth comes from surface steps + hairlines: no boxShadow scale on purpose.
 */
export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: {
        '2xl': '1400px',
      },
    },
    extend: {
      fontFamily: {
        sans: ['Aspekta', 'Inter Tight', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['Roboto Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
      },
      colors: {
        /* Brand */
        ink: {
          DEFAULT: '#222f30',
          2: '#1b2526',
          3: '#2a3737' /* system extension: hover/raised step */,
        },
        lime: '#cef79e',
        bone: '#f7f7f5',
        paper: '#ffffff',
        graphite: '#4d5757',
        lichen: '#c9cbbe',
        tissue: '#e7e8e1',
        void: '#000000',

        /* system extension: text + status on dark */
        'text-2-dark': '#93a29f',
        'text-3-dark': '#6d7c7a',
        ok: '#cef79e',
        warn: '#e5c07a',
        danger: '#e08d84',

        /* Primary action — light button on dark canvas (opposite-surface rule) */
        primary: {
          DEFAULT: '#ffffff',
          foreground: '#222f30',
        },
      },
      borderColor: {
        /* bare `border` = the dark-surface hairline; use border-lichen/tissue on light */
        DEFAULT: '#4d5757',
      },
      fontSize: {
        /* Aspekta scale — tracking tightens as size grows; single 400 weight */
        body: ['16px', { lineHeight: '1.3', letterSpacing: '-0.001em' }],
        'body-lg': ['18px', { lineHeight: '1.3', letterSpacing: '-0.001em' }],
        'body-xl': ['19px', { lineHeight: '1.3', letterSpacing: '-0.001em' }],
        subheading: ['24px', { lineHeight: '1.2', letterSpacing: '-0.004em' }],
        heading: ['36px', { lineHeight: '1.1', letterSpacing: '-0.006em' }],
        'heading-lg': ['42px', { lineHeight: '1.1', letterSpacing: '-0.006em' }],
        'display-sm': ['58px', { lineHeight: '1', letterSpacing: '-0.02em' }],
        display: ['75px', { lineHeight: '1', letterSpacing: '-0.02em' }],
        'display-xl': ['111px', { lineHeight: '1', letterSpacing: '-0.03em' }],
      },
      borderRadius: {
        btn: '8px',
        nav: '12px',
        card: '16px',
        'card-lg': '40px',
        pill: '9999px',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'fade-in-up': {
          from: { opacity: '0', transform: 'translateY(12px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'border-trace': {
          from: { strokeDashoffset: '1000' },
          to: { strokeDashoffset: '0' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.2s ease',
        'fade-in-up': 'fade-in-up 0.45s ease-out',
        'border-trace': 'border-trace 1.2s linear forwards',
      },
    },
  },
  plugins: [animate],
} satisfies Config;
