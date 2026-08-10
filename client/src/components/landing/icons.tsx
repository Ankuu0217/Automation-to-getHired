/*
 * Original single-stroke, technical line-art marks for the landing feature
 * surfaces. All inherit colour via `currentColor`, `fill:none`, and read as
 * abstract instrument glyphs (aperture / lattice / trend) — never literal
 * emoji-style icons. Decorative: each is aria-hidden.
 */
import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

const base = (strokeWidth: number) => ({
  viewBox: '0 0 48 48',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
});

/* ── Platform blocks (thin 1.25) ───────────────────────────────────────── */

/** CAPTURE — a scanning aperture: concentric rings + crosshair ticks. */
export function IconAperture(props: IconProps) {
  return (
    <svg {...base(1.25)} {...props}>
      <circle cx="24" cy="24" r="17" />
      <circle cx="24" cy="24" r="9.5" />
      <circle cx="24" cy="24" r="2.5" />
      <path d="M24 3v6M24 39v6M3 24h6M39 24h6" />
      <path d="M9 9l4 4M39 9l-4 4M9 39l4-4M39 39l-4-4" />
    </svg>
  );
}

/** COMPOSE — overlapping document glyphs, the front one lined. */
export function IconCompose(props: IconProps) {
  return (
    <svg {...base(1.25)} {...props}>
      <rect x="8" y="6" width="22" height="28" rx="2.5" />
      <rect x="18" y="14" width="22" height="28" rx="2.5" />
      <path d="M23 23h12M23 29h12M23 35h8" />
    </svg>
  );
}

/** DISPATCH — a send mark radiating a motion lattice. */
export function IconDispatch(props: IconProps) {
  return (
    <svg {...base(1.25)} {...props}>
      <path d="M7 24L41 9 31 41 24 28 7 24z" />
      <path d="M24 28l17-19" />
      <path d="M4 33h6M2 40h9M6 26h4" />
    </svg>
  );
}

/* ── Feature cards (1.5 for legibility at ~40px) ───────────────────────── */

/** Batch capture — a stack of offset frames. */
export function IconBatch(props: IconProps) {
  return (
    <svg {...base(1.5)} {...props}>
      <rect x="14" y="6" width="26" height="20" rx="2.5" />
      <path d="M10 14v20a2 2 0 002 2h20" />
      <path d="M6 20v18a2 2 0 002 2h18" />
      <path d="M20 16h14" />
    </svg>
  );
}

/** Pipeline board — three columns with a moving card. */
export function IconBoard(props: IconProps) {
  return (
    <svg {...base(1.5)} {...props}>
      <rect x="5" y="8" width="10" height="32" rx="2" />
      <rect x="19" y="8" width="10" height="22" rx="2" />
      <rect x="33" y="8" width="10" height="27" rx="2" />
      <path d="M15 20h4" />
    </svg>
  );
}

/** Analytics & streaks — bars under a rising trend. */
export function IconTrend(props: IconProps) {
  return (
    <svg {...base(1.5)} {...props}>
      <path d="M7 7v34h34" />
      <path d="M14 36v-8M22 36v-14M30 36v-6M38 36v-18" />
      <path d="M13 20l8-7 8 5 8-10" />
    </svg>
  );
}

/** Recruiter contacts — a node addressed by an @ orbit. */
export function IconContacts(props: IconProps) {
  return (
    <svg {...base(1.5)} {...props}>
      <circle cx="24" cy="24" r="7.5" />
      <path d="M31.5 24a7.5 7.5 0 10-3 6" />
      <path d="M31.5 18v8a4 4 0 008 0v-2A15 15 0 1030 38" />
    </svg>
  );
}

/** Dispatch log & follow-ups — logged rows with a send tick. */
export function IconLog(props: IconProps) {
  return (
    <svg {...base(1.5)} {...props}>
      <path d="M9 12h30M9 20h22M9 28h30M9 36h18" />
      <path d="M34 33l4 4 6-8" />
    </svg>
  );
}

/** Templates & tone — a document carrying reusable braces. */
export function IconTemplate(props: IconProps) {
  return (
    <svg {...base(1.5)} {...props}>
      <rect x="9" y="5" width="30" height="38" rx="3" />
      <path d="M20 15c-3 0-3 3-3 5s-2 2-2 2 2 0 2 2 0 5 3 5" />
      <path d="M28 15c3 0 3 3 3 5s2 2 2 2-2 0-2 2 0 5-3 5" />
    </svg>
  );
}
