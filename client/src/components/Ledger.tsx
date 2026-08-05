import type { ApplicationStage, ApplicationSummary } from '@jobmail/shared';
import { AnimatePresence, motion } from 'framer-motion';
import { useState } from 'react';

import { Mono } from '@/components/Mono';
import { StatusLabel, type StatusKind } from '@/components/StatusLabel';
import { cn } from '@/lib/utils';
import { formatDateTime } from '@/pages/pipelineUtils';

const GRID_TEMPLATE = 'grid-cols-[1fr_1.5fr_1.5fr_120px_80px_90px]';

function lastEmailStatus(lastEmail: ApplicationSummary['lastEmail']): StatusKind {
  if (!lastEmail) return 'draft';
  if (lastEmail.bouncedAt) return 'bounced';
  if (lastEmail.repliedAt) return 'replied';
  if (lastEmail.openedAt) return 'opened';
  if (lastEmail.sentAt) return 'sent';
  return 'draft';
}

function resolveStatus(app: ApplicationSummary): StatusKind {
  const emailStatus = lastEmailStatus(app.lastEmail);
  if (emailStatus !== 'draft') return emailStatus;
  return app.stage;
}

function formatSent(days: number | null): string {
  if (days === null) return '—';
  if (days === 0) return 'TODAY';
  if (days === 1) return '1D AGO';
  return `${days}D AGO`;
}

function followUpLabel(app: ApplicationSummary): { text: string; active: boolean } {
  if (!app.nextFollowUpAt) return { text: '—', active: false };
  const days = Math.ceil(
    (new Date(app.nextFollowUpAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
  );
  return { text: `F-UP · ${days}D`, active: true };
}

function timelineItems(app: ApplicationSummary): { label: string; at: string }[] {
  const last = app.lastEmail;
  if (!last) return [];
  const items: { label: string; at: string }[] = [];
  if (last.sentAt) items.push({ label: 'SENT', at: last.sentAt });
  if (last.openedAt) items.push({ label: 'OPENED', at: last.openedAt });
  if (last.repliedAt) items.push({ label: 'REPLIED', at: last.repliedAt });
  if (last.bouncedAt) items.push({ label: 'RETURNED', at: last.bouncedAt });
  return items;
}

interface LedgerProps {
  applications: ApplicationSummary[];
  maxRows?: number;
  className?: string;
  onStageChange?: (id: string, stage: ApplicationStage) => void;
}

export function Ledger({ applications, maxRows, className, onStageChange }: LedgerProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const rows = maxRows ? applications.slice(0, maxRows) : applications;

  return (
    <div className={cn('bg-obsidian', className)}>
      {/* Header */}
      <div
        className={cn(
          'grid h-10 items-center gap-4 border-b border-pure/[0.06] px-4',
          GRID_TEMPLATE,
        )}
      >
        <Mono size="xs" color="fog">
          Company
        </Mono>
        <Mono size="xs" color="fog">
          Role
        </Mono>
        <Mono size="xs" color="fog">
          Contact
        </Mono>
        <Mono size="xs" color="fog">
          Stage
        </Mono>
        <Mono size="xs" color="fog" className="text-right">
          Sent
        </Mono>
        <Mono size="xs" color="fog" className="text-right">
          Follow-up
        </Mono>
      </div>

      {rows.length === 0 ? (
        <div className="px-4 py-8">
          <p className="font-display text-[38px] font-normal leading-[0.9] text-pure">
            No dispatches yet. <span className="italic">Send</span> the first.
          </p>
          <p className="mt-2 font-sans text-base font-normal text-ash">
            Upload a job posting and the ledger builds itself.
          </p>
        </div>
      ) : (
        rows.map((app) => {
          const isExpanded = expandedId === app.id;
          const status = resolveStatus(app);
          const followUp = followUpLabel(app);

          return (
            <div key={app.id} className="border-b border-pure/[0.06] last:border-b-0">
              <button
                type="button"
                onClick={() => setExpandedId(isExpanded ? null : app.id)}
                className={cn(
                  'grid h-12 w-full items-center gap-4 px-4 text-left transition-quick',
                  GRID_TEMPLATE,
                  isExpanded ? 'bg-graphite' : 'hover:bg-graphite',
                )}
              >
                <span className="truncate font-sans text-[15px] font-normal text-cloud">
                  {app.company ?? '—'}
                </span>
                <span className="truncate font-sans text-[15px] font-normal text-ash">
                  {app.role ?? '—'}
                </span>
                <span className="truncate font-mono text-xs normal-case tracking-[0.016em] text-fog">
                  {app.hrEmail}
                </span>
                <StatusLabel status={status} />
                <Mono size="xs" color="ash" className="text-right">
                  {formatSent(app.daysSinceSent)}
                </Mono>
                <Mono size="xs" color={followUp.active ? 'cyan' : 'ash'} className="text-right">
                  {followUp.text}
                </Mono>
              </button>

              <AnimatePresence initial={false}>
                {isExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.28, ease: [0.4, 0, 0.2, 1] }}
                    className="overflow-hidden"
                  >
                    <div className="border-t border-pure/[0.06] bg-abyss px-4 py-4">
                      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
                        <div>
                          <Mono size="xs" color="fog">
                            Correspondence
                          </Mono>
                          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
                            {timelineItems(app).length === 0 ? (
                              <Mono size="md" color="fog">
                                No events recorded.
                              </Mono>
                            ) : (
                              timelineItems(app).map((item, idx, arr) => (
                                <span key={idx} className="flex items-center gap-3">
                                  <Mono size="md" color="ash">
                                    {item.label} {formatDateTime(item.at)}
                                  </Mono>
                                  {idx < arr.length - 1 && (
                                    <Mono size="md" color="fog">
                                      →
                                    </Mono>
                                  )}
                                </span>
                              ))
                            )}
                          </div>
                          {app.nextFollowUpAt && (
                            <p className="mt-3 font-mono text-xs uppercase tracking-[0.016em] text-cyan">
                              NEXT FOLLOW-UP · {formatDateTime(app.nextFollowUpAt)}
                            </p>
                          )}
                        </div>

                        {onStageChange && (
                          <div>
                            <Mono size="xs" color="fog">
                              Stage
                            </Mono>
                            <div className="mt-3 flex flex-wrap gap-2">
                              {(['applied', 'hr_screen', 'interview', 'offer', 'rejected', 'ghosted'] as ApplicationStage[]).map(
                                (stage) => (
                                  <button
                                    key={stage}
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onStageChange(app.id, stage);
                                    }}
                                    className={cn(
                                      'rounded-[8px] border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16px] transition-quick',
                                      app.stage === stage
                                        ? 'border-pure bg-pure text-void'
                                        : 'border-pure/20 text-ash hover:border-pure/40 hover:text-pure',
                                    )}
                                  >
                                    {stage.replace('_', ' ')}
                                  </button>
                                ),
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })
      )}
    </div>
  );
}
