/**
 * Pieces shared by the New Application flow steps: the step header, the
 * processing sequence animation, the disclosure toggle and form constants.
 */
import { ChevronDown } from 'lucide-react';
import { useEffect, useId, useState } from 'react';

import { Mono } from '@/components/Mono';
import { cn } from '@/lib/utils';
import { type FlowStep } from '@/pages/newApplicationUtils';

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const UPLOAD_STEPS = [
  'Reading the posting',
  'Locating the contact',
  'Mapping your profile',
  'Setting the email',
];

export const DRAFT_STEPS = [
  'Matching your profile',
  'Choosing highlights',
  'Drafting the email',
  'Polishing the tone',
];

/* ── Shared processing sequence ─────────────────────────────────── */

export function ProcessingSequence({ steps = UPLOAD_STEPS, className }: { steps?: string[]; className?: string }) {
  const [active, setActive] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setActive((a) => (a + 1) % steps.length), 400);
    return () => clearInterval(id);
  }, [steps.length]);

  return (
    <div className={cn('flex flex-wrap items-center gap-x-2 gap-y-1', className)}>
      <span role="status" className="sr-only">
        Processing — please wait.
      </span>
      {steps.map((label, index) => {
        const isActive = index === active;
        const isPast = index < active;
        return (
          <Mono
            key={label}
            size="xs"
            color={isActive ? 'pure' : isPast ? 'ash' : 'fog'}
            className="transition-quick"
            aria-hidden
          >
            {label}
            {index < steps.length - 1 ? ' →' : ''}
          </Mono>
        );
      })}
    </div>
  );
}

/* ── Stepper header ─────────────────────────────────────────────── */

export function StepsHeader({ current }: { current: FlowStep }) {
  const stepClass = (active: boolean) =>
    cn(
      'inline-flex items-center gap-2 font-mono text-[13px] uppercase tracking-[-0.02em]',
      active ? 'text-paper' : 'text-text-3-dark',
    );
  return (
    <div className="flex items-center justify-center gap-3">
      <span className={stepClass(current === 1)}>
        {current === 1 && <span aria-hidden className="size-1.5 rounded-full bg-lime" />}
        01 UPLOAD
      </span>
      <span aria-hidden className="text-text-3-dark">·</span>
      <span className={stepClass(current === 2)}>
        {current === 2 && <span aria-hidden className="size-1.5 rounded-full bg-lime" />}
        02 REVIEW
      </span>
      <span aria-hidden className="text-text-3-dark">·</span>
      <span className={stepClass(current === 3)}>
        {current === 3 && <span aria-hidden className="size-1.5 rounded-full bg-lime" />}
        03 SEND
      </span>
    </div>
  );
}

/* ── Shared disclosure ──────────────────────────────────────────── */

export function Disclosure({
  title,
  children,
  mono = false,
}: {
  title: string;
  children: string;
  mono?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const contentId = useId();
  return (
    <div className="rounded-btn border border-graphite bg-ink-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="focus-ring flex w-full items-center justify-between rounded-btn px-4 py-3 transition-quick hover:bg-ink-3"
        aria-expanded={open}
        aria-controls={contentId}
      >
        <Mono size="xs" color="pure">{title}</Mono>
        <ChevronDown className={cn('size-4 text-text-2-dark transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div
          id={contentId}
          className={cn(
            'max-h-64 overflow-y-auto border-t border-graphite px-4 py-3 text-sm leading-relaxed text-text-2-dark',
            mono && 'font-mono text-xs uppercase tracking-[0.016em]',
          )}
        >
          {children || 'Nothing extracted.'}
        </div>
      )}
    </div>
  );
}