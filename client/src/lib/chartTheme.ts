/**
 * Chart + inline-SVG colors sourced from the design tokens in index.css.
 * Recharts and SVG attributes accept CSS var() strings, so charts stay in
 * sync with the token set without duplicating hex values.
 */
export const chartTheme = {
  accent: 'var(--cyan)',
  grid: 'var(--border)',
  cursor: 'var(--border-strong)',
  tick: { fill: 'var(--text-3)', fontSize: 11, fontFamily: 'Roboto Mono' },
} as const;
