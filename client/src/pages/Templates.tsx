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

import { CategoryTile } from '@/components/CategoryTile';
import { Mono } from '@/components/Mono';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Sheet, SheetBody, SheetClose, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
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
              <Textarea id="tpl-body" rows={10} placeholder={PLACEHOLDERS} {...register('bodyTemplate')} />
              <p className="text-xs text-fog">{PLACEHOLDERS}</p>
              {formState.errors.bodyTemplate && (
                <p className="text-xs text-danger">{formState.errors.bodyTemplate.message}</p>
              )}
            </div>

            <div className="flex items-start justify-between gap-4 rounded-[8px] border border-pure/[0.06] bg-obsidian p-4">
              <div className="space-y-1">
                <p className="font-sans text-sm font-normal text-cloud">Default template</p>
                <p className="text-xs text-fog">Used automatically when no other template is picked.</p>
              </div>
              <Switch
                checked={watch('isDefault')}
                onCheckedChange={(checked) => setValue('isDefault', checked, { shouldValidate: true })}
              />
            </div>
          </form>
        </SheetBody>
        <div className="border-t border-pure/[0.06] p-6">
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

  const handleDelete = () => {
    if (!confirm(`Delete “${template.name}”? This cannot be undone.`)) return;
    deleteMutation.mutate(template.id);
  };

  const rr = replyRate(template.stats.sent, template.stats.replied);

  return (
    <div
      className={cn(
        'rounded-[16px] border bg-graphite p-5 transition-quick',
        template.isDefault ? 'border-pure/40' : 'border-pure/[0.06] hover:border-pure/20',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Mono size="xs" color="fog">
              TPL-{String(index + 1).padStart(3, '0')}
            </Mono>
            <p className="truncate font-sans text-base font-normal text-cloud">{template.name}</p>
            {template.isDefault && (
              <Mono size="xs" color="orchid">
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
              onClick={() => defaultMutation.mutate(template.id)}
              disabled={defaultMutation.isPending}
            >
              <Star className="size-4 text-fog" />
            </Button>
          )}
          <Button variant="ghost" size="icon" title="Edit" onClick={() => onEdit(template)}>
            <Pencil className="size-4 text-fog" />
          </Button>
          <Button variant="ghost" size="icon" title="Delete" onClick={handleDelete} disabled={deleteMutation.isPending}>
            <Trash2 className="size-4 text-danger" />
          </Button>
        </div>
      </div>

      <div className="mt-4 space-y-1">
        <p className="font-sans text-xs text-fog">Subject</p>
        <p className="truncate font-sans text-sm text-ash">{template.subjectTemplate}</p>
      </div>

      <div className="mt-4 grid grid-cols-4 gap-2 rounded-[8px] border border-pure/[0.06] bg-obsidian p-3">
        <Stat label="Sent" value={template.stats.sent} icon={Send} />
        <Stat label="Opened" value={template.stats.opened} icon={MailOpen} />
        <Stat label="Replied" value={template.stats.replied} icon={Reply} />
        <div className="flex flex-col items-center justify-center gap-1 border-l border-pure/[0.06] pl-2">
          <span className="font-display text-lg font-normal text-cloud">{rr}</span>
          <Mono size="xs" color="fog">
            Reply rate
          </Mono>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, icon: Icon }: { label: string; value: number; icon: React.ElementType }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1">
      <Icon className="size-3.5 text-fog" />
      <span className="font-display text-lg font-normal text-cloud">{value}</span>
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
          <CategoryTile
            color="orchid"
            title="Template studio"
            description="Reusable AI guidance with per-template response-rate stats."
            icon={Send}
            compact
          />
          {defaultTemplate && (
            <p className="mt-4 flex items-center gap-2 font-sans text-xs text-ash">
              <Check className="size-3.5 text-ok" />
              Default: <span className="text-cloud">{defaultTemplate.name}</span>
            </p>
          )}
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Mono size="xs" color="fog">
                Templates
              </Mono>
              <h1 className="mt-1 font-display text-[38px] font-normal leading-[0.9] text-cloud">
                Saved <span className="italic">prompts</span>
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
                <div key={i} className="h-40 rounded-[16px] bg-graphite" />
              ))}
            </div>
          ) : templates.length === 0 ? (
            <div className="rounded-[16px] border border-pure/[0.06] bg-graphite p-12 text-center">
              <p className="font-display text-[38px] font-normal leading-[0.9] text-pure">
                No templates yet. <span className="italic">Save</span> one.
              </p>
              <p className="mx-auto mt-3 max-w-sm font-sans text-base font-normal text-ash">
                Save your best-performing prompts as templates and compare reply rates over time.
              </p>
              <Button onClick={() => setCreating(true)} className="mt-6">
                <Plus className="size-4" />
                Create your first template
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
