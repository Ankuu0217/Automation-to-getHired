import { motion } from 'framer-motion';

import { ArrowSquare } from '@/components/ui/arrow-square';
import { cn } from '@/lib/utils';

import {
  IconBatch,
  IconBoard,
  IconContacts,
  IconLog,
  IconTemplate,
  IconTrend,
} from './icons';

/*
 * "Everything after the send" — a grid of notched cards showcasing the app's
 * real, shipped surfaces. Copy is pulled from the actual page components (their
 * titles quoted in the source), not invented. Each card is one `group/cta`
 * scope: hovering (or focusing the nested square) underlines the title and
 * flips the square's colour — one hover grammar with the rest of the site. The
 * concave bottom-right notch is a clip-path (.notch-card); the arrow square is a
 * SIBLING nested into it. Spacing/radius follow the integratedbio card spec
 * (40px padding, 20px radius).
 */

const MONO = 'font-mono text-[13px] font-normal uppercase tracking-[-0.02em] tabular-nums';
const EASE = [0.16, 1, 0.3, 1] as const;

const SURF = {
  paper: {
    cell: 'bg-paper [--hairline:var(--lichen)]',
    title: 'text-ink',
    body: 'text-graphite',
    label: 'text-graphite',
    icon: 'text-ink',
  },
  ink2: {
    cell: 'bg-ink-2',
    title: 'text-paper',
    body: 'text-text-2-dark',
    label: 'text-text-2-dark',
    icon: 'text-paper',
  },
  ink3: {
    cell: 'bg-ink-3',
    title: 'text-paper',
    body: 'text-text-2-dark',
    label: 'text-text-2-dark',
    icon: 'text-paper',
  },
} as const;

const CARDS = [
  {
    tag: 'BATCH',
    meta: '10×',
    title: 'Batch capture',
    body: 'Drop a stack of screenshots and the AI reads them all in one pass — ten job posts captured at once.',
    to: '/apps/batch',
    Icon: IconBatch,
    surface: 'paper',
  },
  {
    tag: 'PIPELINE',
    meta: 'BOARD',
    title: 'Pipeline board',
    body: 'Every application on one board — drag from Applied to Offer, with opens, replies, and bounces flagged live.',
    to: '/pipeline',
    Icon: IconBoard,
    surface: 'ink2',
  },
  {
    tag: 'ANALYTICS',
    meta: '30-DAY',
    title: 'Analytics & streaks',
    body: 'Opens, replies, response time, and a 30-day trend — plus a send streak that keeps the search honest.',
    to: '/analytics',
    Icon: IconTrend,
    surface: 'ink3',
  },
  {
    tag: 'CONTACTS',
    meta: 'MX-CHECKED',
    title: 'Recruiter contacts',
    body: 'Every recruiter you email, collected into one deduped, MX-checked address book.',
    to: '/contacts',
    Icon: IconContacts,
    surface: 'ink2',
  },
  {
    tag: 'DISPATCHES',
    meta: 'AUTO',
    title: 'Dispatch log & follow-ups',
    body: 'Every send in one log, with follow-ups on schedule that stop the moment a reply lands.',
    to: '/dispatches',
    Icon: IconLog,
    surface: 'paper',
  },
  {
    tag: 'TEMPLATES',
    meta: 'REUSABLE',
    title: 'Templates & tone',
    body: 'Reusable subject and body prompts tuned to your voice — set a default, switch tone per send.',
    to: '/templates',
    Icon: IconTemplate,
    surface: 'ink3',
  },
] as const;

export function FeatureShowcase({ reduce }: { reduce: boolean | null }) {
  const intro = reduce
    ? {}
    : ({
        initial: { opacity: 0, y: 16, clipPath: 'inset(0% 0% 100% 0%)' },
        whileInView: { opacity: 1, y: 0, clipPath: 'inset(0% 0% 0% 0%)' },
        viewport: { once: true, margin: '-12%' },
        transition: { duration: 0.7, ease: EASE },
      } as const);

  const parent = reduce
    ? {}
    : ({
        initial: 'hidden',
        whileInView: 'show',
        viewport: { once: true, margin: '-12%' },
        variants: { show: { transition: { staggerChildren: 0.09 } } },
      } as const);

  const card = reduce
    ? ({
        initial: { opacity: 0 },
        whileInView: { opacity: 1 },
        viewport: { once: true, margin: '-12%' },
        transition: { duration: 0.2 },
      } as const)
    : ({
        variants: {
          hidden: { opacity: 0, y: 16, clipPath: 'inset(0% 0% 100% 0%)' },
          show: {
            opacity: 1,
            y: 0,
            clipPath: 'inset(0% 0% 0% 0%)',
            transition: { duration: 0.7, ease: EASE },
          },
        },
      } as const);

  return (
    <section id="features" className="scroll-mt-8">
      <div className="mx-auto w-full max-w-[1200px] px-6 py-28">
        <motion.div {...intro}>
          <span className={cn(MONO, 'flex items-center gap-3 text-text-2-dark')}>
            <span aria-hidden className="size-1.5 rounded-full bg-lime" />
            AFTER THE SEND
          </span>
          <h2 className="mt-8 max-w-[820px] text-balance text-display-sm font-normal tracking-h2 text-paper">
            Everything after the send.
          </h2>
          <p className="mt-6 max-w-[60ch] text-pretty text-body-xl font-normal tracking-copy text-text-2-dark">
            The screenshot goes out in one click. Everything the search needs afterward — tracked,
            measured, and followed up — lives here.
          </p>
        </motion.div>

        <motion.div {...parent} className="mt-16 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {CARDS.map((c) => {
            const s = SURF[c.surface];
            return (
              // Wrapper carries the group scope + reveal; the ArrowSquare is a
              // SIBLING of the masked .notch-card so the notch never clips it.
              // h-full makes the card fill the (stretched) grid cell so the
              // sibling square always nests IN the notch, never below the card.
              <motion.div key={c.tag} {...card} className="group/cta relative">
                <div
                  className={cn(
                    'notch-card flex h-full min-h-[340px] flex-col p-10 [transition:border-color_200ms] group-hover/cta:[--hairline:var(--text-3-dark)]',
                    s.cell,
                  )}
                >
                  <div className="flex items-start justify-between gap-4">
                    <span className="inline-flex items-center gap-2.5">
                      <span aria-hidden className="size-1.5 rounded-full bg-lime" />
                      <span className={cn(MONO, s.label)}>{c.tag}</span>
                    </span>
                    <span className={cn(MONO, s.label)}>{c.meta}</span>
                  </div>

                  <div className="mt-auto pt-12">
                    <c.Icon className={cn('size-10', s.icon)} />
                    {/* arbitrary 24px (= subheading token) so tailwind-merge
                        doesn't drop it against the dynamic text-{ink|paper} colour. */}
                    <h3
                      className={cn(
                        'mt-6 text-[24px] font-normal leading-[1.2] tracking-[-0.004em] underline-offset-[6px] decoration-1 group-hover/cta:underline',
                        s.title,
                      )}
                    >
                      {c.title}
                    </h3>
                    <p
                      className={cn(
                        'mt-3 max-w-[46ch] text-pretty text-[18px] font-normal leading-[1.3] tracking-[-0.001em]',
                        s.body,
                      )}
                    >
                      {c.body}
                    </p>
                    <span aria-hidden className={cn(MONO, 'mt-8 inline-block', s.label)}>
                      EXPLORE →
                    </span>
                  </div>
                </div>

                <ArrowSquare
                  variant="inverted"
                  size="lg"
                  to={c.to}
                  aria-label={`Explore ${c.title}`}
                  className="absolute bottom-2 right-2"
                />
              </motion.div>
            );
          })}
        </motion.div>
      </div>
    </section>
  );
}
