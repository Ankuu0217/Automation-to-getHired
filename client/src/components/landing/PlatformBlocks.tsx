import { motion } from 'framer-motion';

import { cn } from '@/lib/utils';

import { IconAperture, IconCompose, IconDispatch } from './icons';

/*
 * The PLATFORM band as three edge-to-edge colour blocks with an alternating
 * surface rhythm (lime / ink / bone). Copy is the existing PILLARS, verbatim.
 * On the lime and bone cells icon + text are ink; on the ink cell they're
 * paper — the one accent rule holds (no lime inside the lime cell). Reveal is a
 * left-to-right horizontal clip wipe; hover nudges the mark and brightens the
 * index. Only transform/opacity/clip-path/color animate.
 */

const MONO = 'font-mono text-[13px] font-normal uppercase tracking-[-0.02em] tabular-nums';
const EASE = [0.16, 1, 0.3, 1] as const;

const BLOCKS = [
  {
    index: '01 CAPTURE',
    title: 'Read any job post.',
    body: 'Vision AI pulls the company, role, location, and recruiter address from a screenshot, with a confidence score on every field. Low confidence is flagged, never guessed.',
    Icon: IconAperture,
    cell: 'bg-lime text-ink',
    idle: 'text-ink/80',
    body_cls: 'text-ink/80',
  },
  {
    index: '02 COMPOSE',
    title: 'Written against your resume.',
    body: 'Match analysis scores the role 0–100 against your skills and surfaces the gaps. The draft stays under 180 words, in your tone. Nothing sends without your approval.',
    Icon: IconCompose,
    cell: 'bg-ink-2 text-paper',
    idle: 'text-text-2-dark',
    body_cls: 'text-text-2-dark',
  },
  {
    index: '03 DISPATCH',
    title: 'Sent from your Gmail.',
    body: 'OAuth sending with your resume attached, addresses MX-checked, timing jittered, volume capped. Follow-ups fire on day 3 and day 7 and stop the moment a reply lands.',
    Icon: IconDispatch,
    cell: 'bg-bone text-ink',
    idle: 'text-graphite',
    body_cls: 'text-graphite',
  },
] as const;

export function PlatformBlocks({ reduce }: { reduce: boolean | null }) {
  const parent = reduce
    ? {}
    : ({
        initial: 'hidden',
        whileInView: 'show',
        viewport: { once: true, margin: '-12%' },
        variants: { show: { transition: { staggerChildren: 0.09 } } },
      } as const);

  const child = reduce
    ? ({
        initial: { opacity: 0 },
        whileInView: { opacity: 1 },
        viewport: { once: true, margin: '-12%' },
        transition: { duration: 0.2 },
      } as const)
    : ({
        variants: {
          hidden: { clipPath: 'inset(0 100% 0 0)', scale: 1.02, opacity: 0 },
          show: {
            clipPath: 'inset(0 0 0 0)',
            scale: 1,
            opacity: 1,
            transition: { duration: 0.7, ease: EASE },
          },
        },
      } as const);

  return (
    <motion.div {...parent} className="grid grid-cols-1 md:grid-cols-3">
      {BLOCKS.map((b) => (
        <motion.div
          key={b.index}
          {...child}
          className={cn(
            'group relative flex min-h-[clamp(420px,42vw,560px)] flex-col justify-between overflow-hidden p-8 md:p-10',
            b.cell,
          )}
        >
          <div className="flex items-start justify-between">
            <b.Icon className="size-16 transition-transform duration-200 ease-out group-hover:-rotate-2 group-hover:translate-x-0.5" />
            <span className={cn(MONO, 'transition-colors duration-200 group-hover:text-current', b.idle)}>
              {b.index}
            </span>
          </div>
          <div>
            <h3 className="text-balance text-heading font-normal tracking-h3">{b.title}</h3>
            <p className={cn('mt-4 max-w-[42ch] text-pretty text-body-lg font-normal', b.body_cls)}>
              {b.body}
            </p>
          </div>
        </motion.div>
      ))}
    </motion.div>
  );
}
