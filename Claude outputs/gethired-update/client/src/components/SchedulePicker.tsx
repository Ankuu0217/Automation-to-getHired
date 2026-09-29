import { CalendarClock } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { Mono } from '@/components/Mono';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * "Schedule" button + small panel: quick presets (recruiter-friendly times) and
 * an exact date/time field. Times are the user's local time; the server gets an
 * ISO timestamp and sends at exactly that moment.
 */

/** Value for <input type="datetime-local"> in local time: YYYY-MM-DDTHH:mm */
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function at(daysFromToday: number, hour: number, minute = 0): Date {
  const d = new Date();
  d.setDate(d.getDate() + daysFromToday);
  d.setHours(hour, minute, 0, 0);
  return d;
}

function nextWeekday(dayOfWeek: number, hour: number): Date {
  const d = new Date();
  const diff = (dayOfWeek - d.getDay() + 7) % 7 || 7;
  d.setDate(d.getDate() + diff);
  d.setHours(hour, 0, 0, 0);
  return d;
}

export function formatWhen(d: Date): string {
  return d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function SchedulePicker({
  disabled,
  pending,
  onSchedule,
}: {
  disabled?: boolean;
  pending?: boolean;
  onSchedule: (iso: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  const presets = useMemo(() => {
    if (!open) return [];
    const now = Date.now();
    const list: Array<{ label: string; date: Date }> = [
      { label: 'In 1 hour', date: new Date(Math.ceil((now + 60 * 60 * 1000) / (5 * 60 * 1000)) * 5 * 60 * 1000) },
      { label: 'Today 6 PM', date: at(0, 18) },
      { label: 'Tomorrow 9:30 AM', date: at(1, 9, 30) },
      { label: 'Tomorrow 11 AM', date: at(1, 11) },
      { label: 'Monday 10 AM', date: nextWeekday(1, 10) },
    ];
    return list.filter((p) => p.date.getTime() > now + 5 * 60 * 1000);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setValue(toLocalInput(at(1, 9, 30)));
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const picked = value ? new Date(value) : null;
  const minDate = new Date(Date.now() + 2 * 60 * 1000);
  const tooSoon = picked !== null && picked.getTime() < minDate.getTime();
  const tooFar = picked !== null && picked.getTime() > Date.now() + 60 * 24 * 60 * 60 * 1000;
  const valid = picked !== null && !Number.isNaN(picked.getTime()) && !tooSoon && !tooFar;
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const choose = (d: Date) => {
    onSchedule(d.toISOString());
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <Button variant="outline" onClick={() => setOpen((o) => !o)} disabled={disabled || pending} aria-expanded={open}>
        <CalendarClock className="size-4" />
        Schedule
      </Button>
      {open && (
        <div
          role="dialog"
          aria-label="Schedule send"
          className="absolute bottom-full right-0 z-30 mb-2 w-[min(92vw,320px)] rounded-card border border-graphite bg-ink-2 p-4 shadow-lg"
        >
          <Mono size="xs" color="fog">Send later</Mono>
          <div className="mt-3 flex flex-wrap gap-2">
            {presets.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => choose(p.date)}
                className="focus-ring rounded-pill border border-graphite px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16px] text-text-2-dark transition-quick hover:border-lime hover:text-paper"
              >
                {p.label}
              </button>
            ))}
          </div>

          <label className="mt-4 block font-sans text-xs text-text-2-dark" htmlFor="schedule-at">
            Pick a date &amp; time
          </label>
          <input
            id="schedule-at"
            type="datetime-local"
            value={value}
            min={toLocalInput(minDate)}
            onChange={(e) => setValue(e.target.value)}
            className={cn(
              'focus-ring mt-1 w-full rounded-btn border bg-ink px-3 py-2 font-sans text-sm text-paper [color-scheme:dark]',
              tooSoon || tooFar ? 'border-danger/60' : 'border-graphite',
            )}
          />
          <p className="mt-1 font-sans text-[11px] text-text-3-dark">
            {tooSoon ? 'Pick a time at least 2 minutes from now.' : tooFar ? 'Up to 60 days ahead.' : `Your time zone: ${tz}`}
          </p>

          <Button className="mt-3 w-full" size="sm" disabled={!valid || pending} onClick={() => picked && choose(picked)}>
            {valid && picked ? `Schedule for ${formatWhen(picked)}` : 'Schedule'}
          </Button>
        </div>
      )}
    </div>
  );
}
