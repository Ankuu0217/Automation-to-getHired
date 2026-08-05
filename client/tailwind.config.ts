import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

/*
 * Class-level tokens for the Midnight Gallery system.
 * Values must stay in sync with the CSS variables in src/index.css
 * (kept as literals here so Tailwind alpha modifiers like bg-iris/10 work).
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
        display: ['Instrument Serif', 'Georgia', 'serif'],
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['Roboto Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
      },
      colors: {
        /* Accents — focus rings, links, active states, data-viz only */
        iris: '#847dff',
        cyan: '#00b3dd',
        pale: '#d1c9ff',
        deep: '#4b49aa',
        orchid: '#dd90d8',
        peri: '#90b8f0',

        /* Status */
        ok: '#7fb069',
        warn: '#d9a441',
        danger: '#c4574e',

        /* Surface ladder */
        background: '#0d0e0f',
        surface: {
          DEFAULT: '#151617',
          2: '#1d1e20',
        },

        /* Hairlines */
        border: {
          DEFAULT: 'rgba(255, 255, 255, 0.06)',
          strong: 'rgba(255, 255, 255, 0.12)',
        },

        /* Text ladder */
        'text-1': '#f5f5f7',
        'text-2': '#9f9fa0',
        'text-3': '#6a6b6b',
        pure: '#ffffff',
        void: '#000000',
        silver: '#cacaca',

        /* Primary action — white on black (Krea inversion) */
        primary: {
          DEFAULT: '#ffffff',
          foreground: '#000000',
        },
      },
      borderRadius: {
        func: '8px',
        card: '16px',
        tile: '30px',
        pill: '9999px',
      },
      boxShadow: {
        lg: 'rgba(0, 0, 0, 0.2) 0px 18px 20px 0px',
        'inset-hairline': 'rgba(255, 255, 255, 0.04) 0px 1px 0px 0px inset',
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
        'slide-in-from-right': {
          from: { transform: 'translateX(100%)' },
          to: { transform: 'translateX(0)' },
        },
        'border-trace': {
          from: { strokeDashoffset: '1000' },
          to: { strokeDashoffset: '0' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.2s ease',
        'fade-in-up': 'fade-in-up 0.45s ease-out',
        'slide-in-from-right': 'slide-in-from-right 0.3s ease-out',
        'border-trace': 'border-trace 1.2s linear forwards',
      },
    },
  },
  plugins: [animate],
} satisfies Config;
