import type { ContactResponse } from '@jobmail/shared';
import { useQuery } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { useState } from 'react';

import { EmptyState } from '@/components/EmptyState';
import { Mono } from '@/components/Mono';
import { Skeleton } from '@/components/ui/skeleton';
import { getContact, getContacts } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';

const GRID_TEMPLATE = 'grid-cols-[1.6fr_1.6fr_90px_140px_110px]';
const DAY_MS = 24 * 60 * 60 * 1000;

/** null → '—', today → 'TODAY', otherwise 'ND AGO' (Ledger convention). */
function formatLastContacted(iso: string | null): string {
  if (!iso) return '—';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / DAY_MS);
  if (days <= 0) return 'TODAY';
  if (days === 1) return '1D AGO';
  return `${days}D AGO`;
}

const EMAIL_KIND_LABEL: Record<string, string> = {
  initial: 'INITIAL',
  followup_1: 'FOLLOW-UP 1',
  followup_2: 'FOLLOW-UP 2',
};

/** Expanded well: the full outreach history to one recruiter. */
function ContactHistory({ email }: { email: string }) {
  const detailQuery = useQuery({
    queryKey: ['contacts', email],
    queryFn: () => getContact(email),
  });

  if (detailQuery.isPending) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-4 w-1/2 bg-ink-3" />
        <Skeleton className="h-4 w-1/3 bg-ink-3" />
      </div>
    );
  }

  if (detailQuery.isError || !detailQuery.data) {
    return (
      <Mono size="md" color="fog">
        Could not load the outreach history.
      </Mono>
    );
  }

  return (
    <div className="space-y-4">
      <Mono size="xs" color="fog">
        Outreach history
      </Mono>
      {detailQuery.data.contact.applications.map((application) => (
        <div key={application.id}>
          <p className="font-sans text-sm font-normal text-paper">
            {application.company ?? '—'}
            <span className="text-text-3-dark"> · </span>
            <span className="text-text-2-dark">{application.role ?? '—'}</span>
            <span className="text-text-3-dark"> · </span>
            <span className="font-mono text-[11px] uppercase tracking-[-0.02em] text-text-2-dark">
              {application.stage.replace('_', ' ')}
            </span>
          </p>
          <div className="mt-1.5 space-y-1">
            {application.emails.length === 0 ? (
              <Mono size="md" color="fog">
                No emails recorded.
              </Mono>
            ) : (
              application.emails.map((mail, index) => (
                <div key={index} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Mono size="md" color="fog" className="w-24">
                    {EMAIL_KIND_LABEL[mail.kind] ?? mail.kind}
                  </Mono>
                  <Mono size="md" color="ash">
                    SENT {mail.sentAt ? formatDateTime(mail.sentAt) : '—'}
                  </Mono>
                  {mail.openedAt && (
                    <>
                      <Mono size="md" color="fog">
                        →
                      </Mono>
                      <Mono size="md" color="ash">
                        OPENED {formatDateTime(mail.openedAt)}
                      </Mono>
                    </>
                  )}
                  {mail.repliedAt && (
                    <>
                      <Mono size="md" color="fog">
                        →
                      </Mono>
                      <Mono size="md" color="cyan">
                        REPLIED {formatDateTime(mail.repliedAt)}
                      </Mono>
                    </>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function ContactRow({
  contact,
  expanded,
  onToggle,
}: {
  contact: ContactResponse;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="border-b border-graphite last:border-b-0">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        className={cn(
          'focus-ring grid min-h-14 w-full items-center gap-4 px-4 py-2 text-left transition-quick',
          GRID_TEMPLATE,
          expanded ? 'bg-ink-3' : 'hover:bg-ink-3',
        )}
      >
        <span className="min-w-0">
          <span className="block truncate font-mono text-xs normal-case tracking-[0.016em] text-paper">
            {contact.email}
          </span>
          <span className="block truncate font-sans text-[13px] font-normal text-text-3-dark">
            {contact.name ?? '—'}
          </span>
        </span>
        <span className="min-w-0">
          <span className="block truncate font-sans text-[15px] font-normal text-text-2-dark">
            {contact.companies.length > 0 ? contact.companies.join(' · ') : '—'}
          </span>
          <span className="block truncate font-sans text-[13px] font-normal text-text-3-dark">
            {contact.roles.length > 0 ? contact.roles.join(' · ') : '—'}
          </span>
        </span>
        <Mono size="xs" color="ash" className="text-right">
          {contact.outreachCount}
        </Mono>
        <Mono size="xs" color="ash" className="text-right">
          {formatLastContacted(contact.lastContactedAt)}
        </Mono>
        <span className="flex items-center justify-end gap-2">
          <span
            aria-hidden
            className={cn(
              'size-1.5 rounded-full',
              contact.anyReplied ? 'bg-lime' : 'border border-text-3-dark',
            )}
          />
          <Mono size="xs" color={contact.anyReplied ? 'cyan' : 'fog'}>
            {contact.anyReplied ? 'Replied' : 'No reply'}
          </Mono>
        </span>
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.28, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-hidden"
          >
            <div className="border-t border-graphite bg-ink px-4 py-4">
              <ContactHistory email={contact.email} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function Contacts() {
  const contactsQuery = useQuery({ queryKey: ['contacts'], queryFn: getContacts });
  const [expandedEmail, setExpandedEmail] = useState<string | null>(null);

  const contacts = contactsQuery.data?.contacts ?? [];

  return (
    <div className="space-y-6">
      <div>
        <Mono size="xs" color="fog">
          Contacts
        </Mono>
        <h1 className="mt-1 font-sans text-heading font-normal text-paper">
          Every recruiter.
        </h1>
      </div>

      {contactsQuery.isPending ? (
        <div className="space-y-4 rounded-card border border-graphite bg-ink-2 p-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4">
              <Skeleton className="h-4 w-1/3 bg-ink-3" />
              <Skeleton className="ml-auto h-4 w-20 bg-ink-3" />
            </div>
          ))}
        </div>
      ) : contacts.length === 0 ? (
        <EmptyState
          headline="No recruiters contacted yet."
          description="Send your first outreach and every recruiter you email collects here."
          action={{ to: '/apps/new', label: 'New dispatch' }}
        />
      ) : (
        <div className="overflow-x-auto rounded-card border border-graphite bg-ink-2">
          <div className="min-w-[720px]">
            {/* Header */}
            <div
              className={cn(
                'grid h-10 items-center gap-4 border-b border-graphite px-4',
                GRID_TEMPLATE,
              )}
            >
              <span className="font-mono text-[13px] uppercase tracking-[-0.02em] text-text-3-dark">
                Recruiter
              </span>
              <span className="font-mono text-[13px] uppercase tracking-[-0.02em] text-text-3-dark">
                Company / Roles
              </span>
              <span className="text-right font-mono text-[13px] uppercase tracking-[-0.02em] text-text-3-dark">
                Outreach
              </span>
              <span className="text-right font-mono text-[13px] uppercase tracking-[-0.02em] text-text-3-dark">
                Last contacted
              </span>
              <span className="text-right font-mono text-[13px] uppercase tracking-[-0.02em] text-text-3-dark">
                Replied
              </span>
            </div>

            {contacts.map((contact) => (
              <ContactRow
                key={contact.email}
                contact={contact}
                expanded={expandedEmail === contact.email}
                onToggle={() =>
                  setExpandedEmail(expandedEmail === contact.email ? null : contact.email)
                }
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
