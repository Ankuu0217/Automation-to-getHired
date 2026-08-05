import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

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
        /* Midnight Gallery chromatic colors */
        iris: '#847dff',
        cyan: '#00b3dd',
        pale: '#d1c9ff',
        deep: '#4b49aa',
        orchid: '#dd90d8',
        peri: '#90b8f0',

        /* Surfaces */
        obsidian: '#0f1011',
        abyss: '#090a0b',
        graphite: '#2e2e2e',
        steel: '#3f4041',
        silver: '#cacaca',

        /* Ink */
        pure: '#ffffff',
        cloud: '#f5f5f7',
        ash: '#9f9fa0',
        fog: '#6a6b6b',
        void: '#000000',

        /* Status */
        ok: '#7fb069',
        warn: '#d9a441',
        danger: '#c4574e',

        /* Legacy aliases for transitioning screens */
        'paper-0': 'var(--paper-0)',
        'paper-1': 'var(--paper-1)',
        'paper-2': 'var(--paper-2)',
        'paper-3': 'var(--paper-3)',
        rule: {
          DEFAULT: 'var(--rule)',
          faint: 'var(--rule-faint)',
          strong: 'var(--rule-strong)',
        },
        press: {
          DEFAULT: 'var(--press)',
          soft: 'var(--press-soft)',
          rule: 'var(--press-rule)',
        },
        ink: {
          1: 'var(--ink-1)',
          2: 'var(--ink-2)',
          3: 'var(--ink-3)',
          ok: 'var(--ink-ok)',
          warn: 'var(--ink-warn)',
          danger: 'var(--ink-danger)',
          info: 'var(--ink-info)',
        },
        'gray-0': 'var(--gray-0)',
        'gray-5': 'var(--gray-5)',
        'gray-10': 'var(--gray-10)',
        'gray-15': 'var(--gray-15)',
        'gray-20': 'var(--gray-20)',
        'border-strong': 'var(--border-strong)',
        'text-primary': 'var(--text-primary)',
        'text-secondary': 'var(--text-secondary)',
        'text-tertiary': 'var(--text-tertiary)',
        'accent-soft': 'var(--accent-soft)',

        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
      },
      borderRadius: {
        func: '8px',
        card: '16px',
        tile: '30px',
        pill: '9999px',
        lg: '8px',
        md: '6px',
        sm: '4px',
      },
      boxShadow: {
        lg: 'rgba(0, 0, 0, 0.2) 0px 18px 20px 0px',
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
