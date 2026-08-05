import { zodResolver } from '@hookform/resolvers/zod';
import {
  emailTemplateCreateSchema,
  emailTemplateUpdateSchema,
  type EmailTemplateResponse,
  type Tone,
} from '@jobmail/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, MailOpen, Pencil, Plus, Reply, Send, Star, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { Mono } from '@/components/Mono';
import { AlertDialog } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Sheet, SheetBody, SheetClose, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  ApiRequestError,
  createTemplate,
  deleteTemplate,
  listTemplates,
  setDefaultTemplate,
  updateTemplate,
} from '@/lib/api';
import { cn } from '@/lib/utils';

const TONES: { value: Tone; label: string }[] = [
  { value: 'formal', label: 'Formal' },
  { value: 'confident', label: 'Confident' },
  { value: 'friendly', label: 'Friendly' },
];

const PLACEHOLDERS =
  'Available variables: {{hrName}}, {{firstName}}, {{company}}, {{role}}, {{skills}}, {{candidateName}}. They are passed to the AI as guidance, not substituted literally.';

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiRequestError ? error.message : fallback;
}

function replyRate(sent: number, replied: number): string {
  return sent === 0 ? '—' : `${Math.round((replied / sent) * 100)}%`;
}

interface TemplateFormValues {
  name: string;
  tone: Tone;
  subjectTemplate: string;
  bodyTemplate: string;
  isDefault: boolean;
}

function TemplateSheet({
  template,
  open,
  onClose,
}: {
  template?: EmailTemplateResponse;
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const isEdit = Boolean(template);

  const { register, handleSubmit, reset, watch, setValue, formState } = useForm<TemplateFormValues>({
    resolver: zodResolver(isEdit ? emailTemplateUpdateSchema : emailTemplateCreateSchema),
    defaultValues: {
      name: template?.name ?? '',
      tone: template?.tone ?? 'formal',
      subjectTemplate: template?.subjectTemplate ?? '',
      bodyTemplate: template?.bodyTemplate ?? '',
      isDefault: template?.isDefault ?? false,
    },
  });

  const saveMutation = useMutation({
    mutationFn: (values: TemplateFormValues) =>
      isEdit && template ? updateTemplate(template.id, values) : createTemplate(values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] });
      toast.success(isEdit ? 'Template updated.' : 'Template created.');
      onClose();
      reset();
    },
    onError: (error) => toast.error(errorMessage(error, `Could not ${isEdit ? 'update' : 'create'} template.`)),
  });

  const onSubmit = handleSubmit((values) => saveMutation.mutate(values));

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()} aria-label={isEdit ? 'Edit template' : 'New template'}>
      <div className="flex h-full flex-col">
        <SheetHeader>
          <div className="flex items-start justify-between">
            <div>
              <SheetTitle>{isEdit ? 'Edit template' : 'New template'}</SheetTitle>
              <SheetDescription>
                Templates steer the AI’s voice. Set one as default to use it automatically.
              </SheetDescription>
            </div>
            <SheetClose onClose={onClose} />
          </div>
        </SheetHeader>
        <SheetBody>
          <form id="template-form" onSubmit={onSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="tpl-name">Name</Label>
              <Input id="tpl-name" placeholder="e.g. Confident fintech outreach" {...register('name')} />
              {formState.errors.name && <p className="text-xs text-danger">{formState.errors.name.message}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="tpl-tone">Tone</Label>
              <Select
                id="tpl-tone"
                value={watch('tone')}
                onChange={(e) => setValue('tone', e.target.value as Tone, { shouldValidate: true })}
              >
                {TONES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="tpl-subject">Subject template</Label>
              <Input id="tpl-subject" placeholder="e.g. Application: {{role}} — {{candidateName}}" {...register('subjectTemplate')} />
              {formState.errors.subjectTemplate && (
                <p className="text-xs text-danger">{formState.errors.subjectTemplate.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="tpl-body">Body template</Label>
              <Textarea
                id="tpl-body"
                rows={10}
                placeholder="Write the guidance the AI should follow for the email body…"
                {...register('bodyTemplate')}
              />
              <p className="text-xs text-text-3-dark">{PLACEHOLDERS}</p>
              {formState.errors.bodyTemplate && (
                <p className="text-xs text-danger">{formState.errors.bodyTemplate.message}</p>
              )}
            </div>

            <div className="flex items-start justify-between gap-4 rounded-btn border border-graphite bg-ink p-4">
              <div className="space-y-1">
                <p className="font-sans text-sm font-normal text-paper">Default template</p>
                <p className="text-xs text-text-3-dark">Used automatically when no other template is picked.</p>
              </div>
              <Switch
                checked={watch('isDefault')}
                onCheckedChange={(checked) => setValue('isDefault', checked, { shouldValidate: true })}
              />
            </div>
          </form>
        </SheetBody>
        <div className="border-t border-graphite p-6">
          <Button type="submit" form="template-form" disabled={saveMutation.isPending} className="w-full">
            {saveMutation.isPending && <Loader2 className="size-4 animate-spin" />}
            {isEdit ? 'Save changes' : 'Create template'}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}

function TemplateCard({
  template,
  index,
  onEdit,
}: {
  template: EmailTemplateResponse;
  index: number;
  onEdit: (t: EmailTemplateResponse) => void;
}) {
  const queryClient = useQueryClient();
  const [deleteOpen, setDeleteOpen] = useState(false);

  const deleteMutation = useMutation({
    mutationFn: deleteTemplate,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] });
      toast.success('Template deleted.');
    },
    onError: (error) => toast.error(errorMessage(error, 'Could not delete template.')),
  });

  const defaultMutation = useMutation({
    mutationFn: setDefaultTemplate,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['templates'] }),
    onError: (error) => toast.error(errorMessage(error, 'Could not set default template.')),
  });

  const handleDelete = () => setDeleteOpen(true);

  const rr = replyRate(template.stats.sent, template.stats.replied);

  return (
    <div
      className={cn(
        'rounded-card border bg-ink-2 p-4 transition-quick',
        template.isDefault ? 'border-lime' : 'border-graphite hover:border-text-3-dark',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Mono size="xs" color="fog">
              TPL-{String(index + 1).padStart(3, '0')}
            </Mono>
            <p className="truncate font-sans text-base font-normal text-paper">{template.name}</p>
            {template.isDefault && (
              <Mono size="xs" color="cyan">
                DEFAULT
              </Mono>
            )}
          </div>
          <Mono size="xs" color="ash" className="mt-1">
            {template.tone}
          </Mono>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {!template.isDefault && (
            <Button
              variant="ghost"
              size="icon"
              title="Set as default"
              aria-label={`Set ${template.name} as default`}
              onClick={() => defaultMutation.mutate(template.id)}
              disabled={defaultMutation.isPending}
            >
              <Star className="size-4 text-text-3-dark" />
            </Button>
          )}
          <Button variant="ghost" size="icon" title="Edit" aria-label={`Edit ${template.name}`} onClick={() => onEdit(template)}>
            <Pencil className="size-4 text-text-3-dark" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            title="Delete"
            aria-label={`Delete ${template.name}`}
            onClick={handleDelete}
            disabled={deleteMutation.isPending}
          >
            <Trash2 className="size-4 text-danger" />
          </Button>
        </div>
      </div>

      <div className="mt-4 space-y-1">
        <p className="font-sans text-xs text-text-3-dark">Subject</p>
        <p className="truncate font-sans text-sm text-text-2-dark">{template.subjectTemplate}</p>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 rounded-btn border border-graphite bg-ink p-3 sm:grid-cols-4">
        <Stat label="Sent" value={template.stats.sent} icon={Send} />
        <Stat label="Opened" value={template.stats.opened} icon={MailOpen} />
        <Stat label="Replied" value={template.stats.replied} icon={Reply} />
        <div className="flex flex-col items-center justify-center gap-1 border-l border-graphite pl-2">
          <span className="font-sans text-lg font-normal text-paper">{rr}</span>
          <Mono size="xs" color="fog">
            Reply rate
          </Mono>
        </div>
      </div>

      <AlertDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete template?"
        description={`“${template.name}” will be permanently removed. This cannot be undone.`}
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          setDeleteOpen(false);
          deleteMutation.mutate(template.id);
        }}
      />
    </div>
  );
}

function Stat({ label, value, icon: Icon }: { label: string; value: number; icon: React.ElementType }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1">
      <Icon className="size-3.5 text-text-3-dark" />
      <span className="font-sans text-lg font-normal text-paper">{value}</span>
      <Mono size="xs" color="fog">
        {label}
      </Mono>
    </div>
  );
}

export function Templates() {
  const templatesQuery = useQuery({ queryKey: ['templates'], queryFn: listTemplates });
  const [editing, setEditing] = useState<EmailTemplateResponse | undefined>(undefined);
  const [creating, setCreating] = useState(false);

  const templates = templatesQuery.data?.templates ?? [];
  const defaultTemplate = templates.find((t) => t.isDefault);

  const closeSheet = () => {
    setEditing(undefined);
    setCreating(false);
  };

  return (
    <div className="space-y-6">
      {/* Orchid module marker */}
      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <div>
          <div className="flex flex-col justify-between rounded-card border border-graphite bg-ink-2 p-6">
            <div className="flex size-9 items-center justify-center rounded-btn border border-graphite bg-ink-3 text-text-2-dark">
              <Send className="size-4" strokeWidth={1.5} />
            </div>
            <div className="mt-6">
              <h3 className="font-sans text-subheading text-paper">Template studio</h3>
              <p className="mt-2 font-sans text-sm font-normal leading-[1.5] text-text-2-dark">
                Reusable AI guidance with per-template response-rate stats.
              </p>
            </div>
          </div>
          {defaultTemplate && (
            <p className="mt-4 flex items-center gap-2 font-sans text-xs text-text-2-dark">
              <Check className="size-3.5 text-ok" />
              Default: <span className="text-paper">{defaultTemplate.name}</span>
            </p>
          )}
        </div>

        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <Mono size="xs" color="fog">
                Templates
              </Mono>
              <h1 className="mt-1 font-sans text-heading text-paper">
                Saved prompts.
              </h1>
            </div>
            <Button onClick={() => setCreating(true)}>
              <Plus className="size-4" />
              New template
            </Button>
          </div>

          {templatesQuery.isPending ? (
            <div className="space-y-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-40 w-full rounded-card" />
              ))}
            </div>
          ) : templates.length === 0 ? (
            <div className="rounded-card border border-graphite bg-ink-2 px-6 py-10">
              <p className="font-sans text-heading text-paper">
                No templates yet. Save one.
              </p>
              <p className="mt-2 max-w-md font-sans text-base font-normal text-text-2-dark">
                Save your best-performing prompts as templates and compare reply rates over time.
              </p>
              <Button size="sm" onClick={() => setCreating(true)} className="mt-5">
                New template
                <span aria-hidden>→</span>
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              {templates.map((template, i) => (
                <TemplateCard key={template.id} template={template} index={i} onEdit={setEditing} />
              ))}
            </div>
          )}
        </div>
      </div>

      {(creating || editing) && (
        <TemplateSheet template={editing} open={creating || Boolean(editing)} onClose={closeSheet} />
      )}
    </div>
  );
}
