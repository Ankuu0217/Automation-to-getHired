import type { Tone } from '@jobmail/shared';
import { useEffect, useRef, useState, type ReactNode, type ChangeEvent } from 'react';

import { usePrevious } from '@/hooks/usePrevious';

import { Mono } from '@/components/Mono';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const TONES: { value: Tone; label: string }[] = [
  { value: 'formal', label: 'Formal' },
  { value: 'confident', label: 'Confident' },
  { value: 'friendly', label: 'Friendly' },
];

interface ProofSheetProps {
  fromName: string;
  fromEmail: string;
  toName: string | null;
  toEmail: string;
  subject: string;
  body: string;
  attachmentName?: string;
  attachmentSize?: string;
  tone: Tone;
  isGenerating?: boolean;
  isSending?: boolean;
  queuedAt?: string | null;
  className?: string;
  editing?: boolean;
  footerActions?: ReactNode;
  onToneChange?: (tone: Tone) => void;
  onRegenerate?: () => void;
  onSend?: () => void;
  onEditingChange?: (editing: boolean) => void;
  onBodyChange?: (body: string) => void;
  onSubjectChange?: (subject: string) => void;
  onSave?: (payload: { subject: string; body: string }) => void;
}

export function ProofSheet({
  fromName,
  fromEmail,
  toName,
  toEmail,
  subject,
  body,
  attachmentName,
  attachmentSize,
  tone,
  isGenerating = false,
  isSending = false,
  queuedAt,
  className,
  editing: controlledEditing,
  footerActions,
  onToneChange,
  onRegenerate,
  onSend,
  onEditingChange,
  onBodyChange,
  onSubjectChange,
  onSave,
}: ProofSheetProps) {
  const [internalEditing, setInternalEditing] = useState(false);
  const [editBody, setEditBody] = useState(body);
  const [showTrace, setShowTrace] = useState(false);
  const traceRef = useRef<HTMLDivElement>(null);
  const wasGenerating = usePrevious(isGenerating);

  const isEditing = controlledEditing ?? internalEditing;
  const setEditing = (value: boolean) => {
    if (controlledEditing === undefined) {
      setInternalEditing(value);
    }
    onEditingChange?.(value);
  };

  useEffect(() => {
    setEditBody(body);
  }, [body]);

  useEffect(() => {
    if (wasGenerating && !isGenerating) {
      setShowTrace(true);
      const timer = setTimeout(() => setShowTrace(false), 1200);
      return () => clearTimeout(timer);
    }
  }, [isGenerating, wasGenerating]);

  const toneTabs = (
    <div className="flex items-center gap-4">
      {TONES.map((t) => (
        <button
          key={t.value}
          type="button"
          disabled={isGenerating || isSending}
          onClick={() => onToneChange?.(t.value)}
          className={cn(
            'pb-1 font-mono text-[11px] uppercase tracking-[0.16px] transition-quick',
            tone === t.value
              ? 'border-b border-pure text-pure'
              : 'border-b border-transparent text-fog hover:text-pure',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );

  return (
    <div
      ref={traceRef}
      className={cn(
        'relative overflow-hidden rounded-[16px] bg-graphite p-8',
        className,
      )}
    >
      {showTrace && (
        <svg
          className="pointer-events-none absolute inset-0 size-full"
          preserveAspectRatio="none"
        >
          <rect
            x="0.5"
            y="0.5"
            fill="none"
            stroke="rgba(255,255,255,0.4)"
            strokeWidth="1"
            strokeDasharray="1000"
            className="animate-border-trace"
            style={{ width: 'calc(100% - 1px)', height: 'calc(100% - 1px)' }}
            rx="16"
            ry="16"
          />
        </svg>
      )}

      {/* Header */}
      <div className="space-y-0">
        <div className="flex items-baseline gap-4 border-b border-pure/[0.06] py-3">
          <Mono size="xs" color="fog" className="w-16 shrink-0">
            From
          </Mono>
          <span className="font-sans text-sm font-normal text-cloud">
            {fromName} <span className="text-fog">&lt;{fromEmail}&gt;</span>
          </span>
        </div>
        <div className="flex items-baseline gap-4 border-b border-pure/[0.06] py-3">
          <Mono size="xs" color="fog" className="w-16 shrink-0">
            To
          </Mono>
          <span className="font-mono text-xs normal-case tracking-[0.016em] text-cloud">
            {toName ? `${toName} <${toEmail}>` : toEmail}
          </span>
        </div>
        <div className="flex items-baseline gap-4 border-b border-pure/[0.06] py-3">
          <Mono size="xs" color="fog" className="w-16 shrink-0">
            Subject
          </Mono>
          {isEditing && onSubjectChange ? (
            <input
              type="text"
              value={subject}
              onChange={(e: ChangeEvent<HTMLInputElement>) => onSubjectChange(e.target.value)}
              className="min-w-0 flex-1 bg-transparent font-sans text-sm font-normal text-cloud outline-none placeholder:text-fog"
            />
          ) : (
            <span className="min-w-0 flex-1 font-sans text-sm font-normal text-cloud">{subject}</span>
          )}
          {queuedAt && (
            <Mono size="xs" color="cyan" className="ml-auto">
              Queued · Sends {new Date(queuedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
            </Mono>
          )}
        </div>
      </div>

      {/* Tone tabs */}
      <div className="mt-6 flex items-center justify-between">
        {toneTabs}
        {isEditing ? (
          <button
            type="button"
            onClick={() => {
              onSave?.({ subject, body: onBodyChange ? body : editBody });
              setEditing(false);
            }}
            className="font-mono text-[11px] uppercase tracking-[0.16px] text-fog transition-quick hover:text-pure"
          >
            {onSave ? 'Save' : 'Done'}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="font-mono text-[11px] uppercase tracking-[0.16px] text-fog transition-quick hover:text-pure"
          >
            Edit
          </button>
        )}
      </div>

      {/* Body */}
      <div className="mt-6 min-h-[200px]">
        {isEditing ? (
          <textarea
            value={onBodyChange ? body : editBody}
            onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
              onBodyChange ? onBodyChange(e.target.value) : setEditBody(e.target.value)
            }
            className="h-[280px] w-full resize-none bg-transparent font-sans text-[15px] font-normal leading-[1.6] text-cloud placeholder:text-fog outline-none"
          />
        ) : (
          <div className="whitespace-pre-wrap font-sans text-[15px] font-normal leading-[1.6] text-cloud">
            {onBodyChange ? body : editBody}
          </div>
        )}
      </div>

      {/* Attachment */}
      {attachmentName && (
        <div className="mt-6 inline-flex items-center gap-3 rounded-[8px] border border-pure/[0.06] px-4 py-2">
          <Mono size="xs" color="ash">
            [PDF]
          </Mono>
          <span className="font-mono text-xs normal-case tracking-[0.016em] text-ash">
            {attachmentName} · {attachmentSize}
          </span>
        </div>
      )}

      {/* Actions */}
      <div className="mt-8 flex items-center justify-end gap-3">
        {footerActions ?? (
          <>
            <Button
              variant="outline"
              disabled={isGenerating || isSending}
              onClick={() => onRegenerate?.()}
            >
              Regenerate
            </Button>
            <Button disabled={isGenerating || isSending} onClick={() => onSend?.()}>
              {isSending ? 'Sending…' : 'Send email'}
              <span aria-hidden>→</span>
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
