import { zodResolver } from '@hookform/resolvers/zod';
import type { ResumeFileMeta, Tone } from '@jobmail/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Check, FileText, Mail, SlidersHorizontal, UploadCloud, User, X } from 'lucide-react';
import { useEffect, useRef, useState, type DragEvent } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { z } from 'zod';

import { GmailConnectPanel } from '@/components/GmailConnect';
import { Logo } from '@/components/Logo';
import { Mono } from '@/components/Mono';
import { ArrowSquare } from '@/components/ui/arrow-square';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { ApiRequestError, getProfile, updateProfile, updateSettings, uploadResume } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth';

const MAX_RESUME_BYTES = 10 * 1024 * 1024;

const STEPS = [
  { title: 'Profile', icon: User },
  { title: 'Tone & limits', icon: SlidersHorizontal },
  { title: 'Gmail', icon: Mail },
] as const;

const TONE_OPTIONS: { value: Tone; title: string; description: string }[] = [
  { value: 'formal', title: 'Formal', description: 'Polished and traditional. Safe for enterprise and consulting.' },
  { value: 'confident', title: 'Confident', description: 'Direct and assured. Leads with impact and numbers.' },
  { value: 'friendly', title: 'Friendly', description: 'Warm and conversational. Good for startups and small teams.' },
] as const;

const profileFormSchema = z.object({
  fullName: z.string().trim().max(100, 'Keep it under 100 characters'),
  headline: z.string().trim().max(200, 'Keep it under 200 characters'),
  phone: z.string().trim().max(30, 'Keep it under 30 characters'),
  location: z.string().trim().max(100, 'Keep it under 100 characters'),
  yearsExp: z.coerce.number().min(0, 'Can’t be negative').max(50, 'Really?'),
  linkedin: z.string().trim().url('Must be a valid URL').or(z.literal('')),
  github: z.string().trim().url('Must be a valid URL').or(z.literal('')),
  portfolio: z.string().trim().url('Must be a valid URL').or(z.literal('')),
});
type ProfileFormValues = z.infer<typeof profileFormSchema>;

/* ── Step indicator ─────────────────────────────────────────────── */

function StepIndicator({ current }: { current: number }) {
  return (
    <ol aria-label="Setup progress" className="flex flex-wrap items-center justify-center gap-2">
      {STEPS.map((step, index) => {
        const done = index < current;
        const active = index === current;
        return (
          <li
            key={step.title}
            aria-current={active ? 'step' : undefined}
            className={cn('flex items-center gap-2 rounded-pill px-3 py-1', active && 'bg-ink-3')}
          >
            {done ? (
              <Check aria-hidden className="size-3 text-lime" />
            ) : (
              <span
                aria-hidden
                className={cn('size-1.5 rounded-full', active ? 'bg-lime' : 'bg-text-3-dark')}
              />
            )}
            <Mono size="sm" color={done ? 'ash' : 'fog'} className={cn(active && 'text-paper')}>
              STEP 0{index + 1} / 0{STEPS.length}
              <span className="sr-only"> — {step.title}</span>
            </Mono>
          </li>
        );
      })}
    </ol>
  );
}

/* ── Skills chip editor ─────────────────────────────────────────── */

function SkillsEditor({ skills, onChange }: { skills: string[]; onChange: (skills: string[]) => void }) {
  const [draft, setDraft] = useState('');

  const addSkill = () => {
    const value = draft.trim();
    if (!value) return;
    if (skills.length >= 50) {
      toast.error('Maximum of 50 skills.');
      return;
    }
    if (!skills.some((s) => s.toLowerCase() === value.toLowerCase())) {
      onChange([...skills, value]);
    }
    setDraft('');
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {skills.map((skill) => (
          <span
            key={skill}
            className="inline-flex items-center gap-1 rounded-pill border border-graphite px-2.5 py-1 font-sans text-xs text-text-2-dark"
          >
            {skill}
            <button
              type="button"
              aria-label={`Remove ${skill}`}
              onClick={() => onChange(skills.filter((s) => s !== skill))}
              className="focus-ring rounded-pill p-0.5 text-text-3-dark transition-quick hover:text-paper"
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
        {skills.length === 0 && <p className="font-sans text-sm text-text-2-dark">No skills yet — add a few below.</p>}
      </div>
      <div className="flex gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              addSkill();
            }
          }}
          placeholder="Add a skill (e.g. React) and press Enter"
        />
        <Button type="button" variant="outline" size="icon" onClick={addSkill} aria-label="Add skill">
          <span aria-hidden>+</span>
        </Button>
      </div>
    </div>
  );
}

/* ── Step 1: Resume + profile ───────────────────────────────────── */

interface ResumeUploadProps {
  onUploaded: (skills: string[], summary: string, meta: ResumeFileMeta) => void;
}

function ResumeUpload({ onUploaded }: ResumeUploadProps) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const uploadMutation = useMutation({
    mutationFn: uploadResume,
    onSuccess: (data) => {
      onUploaded(data.prefill.skills, data.prefill.summary, data.resumeFile);
      toast.success('Resume parsed — review the prefill below.');
    },
    onError: (error) => {
      toast.error(error instanceof ApiRequestError ? error.message : 'Could not parse that PDF.');
    },
  });

  const handleFile = (file: File | undefined | null) => {
    if (!file) return;
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    if (!isPdf) {
      toast.error('PDF only — export your resume as a PDF first.');
      return;
    }
    if (file.size > MAX_RESUME_BYTES) {
      toast.error('File too large — resumes must be 10 MB or less.');
      return;
    }
    uploadMutation.mutate(file);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    handleFile(event.dataTransfer.files?.[0]);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          inputRef.current?.click();
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={cn(
        'focus-ring flex cursor-pointer flex-col items-center gap-3 rounded-btn border border-dashed px-6 py-10 text-center transition-quick',
        dragging ? 'border-lime bg-ink' : 'border-graphite bg-ink hover:border-text-3-dark',
        uploadMutation.isPending && 'pointer-events-none opacity-60',
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(e) => {
          handleFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      {uploadMutation.isPending ? (
        <Mono size="sm" className="text-paper">Parsing…</Mono>
      ) : (
        <UploadCloud className="size-8 text-text-2-dark" />
      )}
      <div>
        <p className="font-sans text-sm font-normal text-paper">
          {uploadMutation.isPending ? 'Parsing your resume…' : 'Drop your resume PDF here, or click to browse'}
        </p>
        <Mono size="xs" color="fog" className="mt-1">
          PDF only, up to 10 MB
        </Mono>
      </div>
    </div>
  );
}

function ProfileStep({
  uploaded,
  skills,
  summary,
  fileName,
  onSkillsChange,
  onSummaryChange,
  onUploaded,
  onContinue,
}: {
  uploaded: boolean;
  skills: string[];
  summary: string;
  fileName: string | null;
  onSkillsChange: (skills: string[]) => void;
  onSummaryChange: (summary: string) => void;
  onUploaded: (skills: string[], summary: string, meta: ResumeFileMeta) => void;
  onContinue: () => void;
}) {
  const profileQuery = useQuery({ queryKey: ['profile'], queryFn: getProfile });
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ProfileFormValues>({
    resolver: zodResolver(profileFormSchema),
    defaultValues: {
      fullName: '',
      headline: '',
      phone: '',
      location: '',
      yearsExp: 0,
      linkedin: '',
      github: '',
      portfolio: '',
    },
  });

  useEffect(() => {
    if (!profileQuery.data) return;
    const p = profileQuery.data.profile;
    reset({
      fullName: p.fullName,
      headline: p.headline,
      phone: p.phone,
      location: p.location,
      yearsExp: p.yearsExp ?? 0,
      linkedin: p.links.linkedin,
      github: p.links.github,
      portfolio: p.links.portfolio,
    });
  }, [profileQuery.data, reset]);

  const saveMutation = useMutation({
    mutationFn: updateProfile,
    onSuccess: () => {
      toast.success('Profile saved.');
      onContinue();
    },
    onError: (error) => {
      toast.error(error instanceof ApiRequestError ? error.message : 'Could not save your profile.');
    },
  });

  const onSubmit = (values: ProfileFormValues) => {
    saveMutation.mutate({
      fullName: values.fullName,
      headline: values.headline,
      phone: values.phone,
      location: values.location,
      yearsExp: values.yearsExp,
      links: { linkedin: values.linkedin, github: values.github, portfolio: values.portfolio },
      skills,
      summary,
    });
  };

  return (
    <div className="space-y-6">
      <ResumeUpload onUploaded={onUploaded} />

      {uploaded && (
        <div className="animate-fade-in-up space-y-5">
          {fileName && (
            <div className="flex items-center gap-2">
              <FileText className="size-4 text-text-2-dark" />
              <Mono size="xs" color="ash" className="normal-case">
                {fileName}
              </Mono>
              <Mono size="xs" color="ok">PARSED</Mono>
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="font-sans text-sm font-normal text-paper">Extracted skills — edit to taste</Label>
            <SkillsEditor skills={skills} onChange={onSkillsChange} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="prefill-summary" className="font-sans text-sm font-normal text-paper">
              Professional summary
            </Label>
            <Textarea
              id="prefill-summary"
              rows={5}
              value={summary}
              onChange={(e) => onSummaryChange(e.target.value)}
              placeholder="A short paragraph on who you are and what you do best."
            />
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" error={errors.fullName?.message}>
            <Input
              placeholder="Ada Lovelace"
              {...register('fullName')}
            />
          </Field>
          <Field label="Headline" error={errors.headline?.message}>
            <Input
              placeholder="Backend Engineer · Node.js · Fintech"
              {...register('headline')}
            />
          </Field>
          <Field label="Location" error={errors.location?.message}>
            <Input
              placeholder="Bengaluru, India"
              {...register('location')}
            />
          </Field>
          <Field label="Years of experience" error={errors.yearsExp?.message}>
            <Input
              type="number"
              min={0}
              max={50}
              {...register('yearsExp')}
            />
          </Field>
        </div>

        <Field label="Phone" error={errors.phone?.message}>
          <Input
            placeholder="+91 98765 43210"
            {...register('phone')}
          />
        </Field>

        <Field label="LinkedIn URL" error={errors.linkedin?.message}>
          <Input
            placeholder="https://linkedin.com/in/…"
            {...register('linkedin')}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="GitHub URL" error={errors.github?.message}>
            <Input
              placeholder="https://github.com/…"
              {...register('github')}
            />
          </Field>
          <Field label="Portfolio URL" error={errors.portfolio?.message}>
            <Input
              placeholder="https://…"
              {...register('portfolio')}
            />
          </Field>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button type="submit" disabled={saveMutation.isPending}>
            {saveMutation.isPending ? 'Saving…' : 'Save & continue'}
          </Button>
          <ArrowSquare
            aria-label="Continue to step 2"
            onClick={() => {
              if (!saveMutation.isPending) void handleSubmit(onSubmit)();
            }}
          />
        </div>
      </form>
    </div>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="font-sans text-sm font-normal text-paper">{label}</Label>
      {children}
      {error && (
        <Mono size="xs" color="danger">
          {error}
        </Mono>
      )}
    </div>
  );
}

/* ── Step 2: Tone & sending limits ──────────────────────────────── */

function ToneStep({ onContinue, onBack }: { onContinue: () => void; onBack: () => void }) {
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const [tone, setTone] = useState<Tone>(user?.settings.tone ?? 'formal');
  const [dailySendCap, setDailySendCap] = useState(user?.settings.dailySendCap ?? 30);
  const [followUpEnabled, setFollowUpEnabled] = useState(user?.settings.followUpEnabled ?? true);

  const saveMutation = useMutation({
    mutationFn: updateSettings,
    onSuccess: (data) => {
      setUser(data.user);
      toast.success('Preferences saved.');
      onContinue();
    },
    onError: (error) => {
      toast.error(error instanceof ApiRequestError ? error.message : 'Could not save preferences.');
    },
  });

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label className="font-sans text-sm font-normal text-paper">Email tone</Label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {TONE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setTone(option.value)}
              aria-pressed={tone === option.value}
              className={cn(
                'focus-ring rounded-btn border p-4 text-left transition-quick',
                tone === option.value
                  ? 'border-lime bg-ink-2'
                  : 'border-graphite bg-ink-2 hover:border-text-3-dark',
              )}
            >
              <p className="flex items-center gap-2 font-sans text-sm font-normal text-paper">
                {tone === option.value && <span aria-hidden className="size-1.5 rounded-full bg-lime" />}
                {option.title}
              </p>
              <p className="mt-1 font-sans text-xs leading-relaxed text-text-2-dark">{option.description}</p>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-3 rounded-btn border border-graphite bg-ink-2 p-4">
        <div className="flex items-center justify-between">
          <Label htmlFor="daily-cap" className="font-sans text-sm font-normal text-paper">
            Daily send cap
          </Label>
          <Mono size="xs" className="text-paper">
            {dailySendCap} / DAY
          </Mono>
        </div>
        <input
          id="daily-cap"
          type="range"
          min={1}
          max={100}
          value={dailySendCap}
          onChange={(e) => setDailySendCap(Number(e.target.value))}
          aria-label="Daily send cap"
          className="slider w-full"
        />
        <p className="font-sans text-xs text-text-2-dark">
          We never exceed this, and we pace sends with human-like jitter. Lower caps keep deliverability high.
        </p>
      </div>

      <div className="flex items-center justify-between rounded-btn border border-graphite bg-ink-2 p-4">
        <div>
          <p className="font-sans text-sm font-normal text-paper">Automatic follow-ups</p>
          <p className="mt-0.5 font-sans text-xs text-text-2-dark">
            Send a polite nudge on day 3 and day 7 when there’s no reply. Stops automatically on reply or bounce.
          </p>
        </div>
        <Switch checked={followUpEnabled} onCheckedChange={setFollowUpEnabled} aria-label="Automatic follow-ups" />
      </div>

      <div className="flex items-center justify-between">
        <Button type="button" variant="ghost" onClick={onBack}>
          <span aria-hidden>←</span>
          Back
        </Button>
        <div className="flex items-center gap-2">
          <Button
            onClick={() => saveMutation.mutate({ tone, dailySendCap, followUpEnabled })}
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending ? 'Saving…' : 'Save & continue'}
          </Button>
          <ArrowSquare
            aria-label="Continue to step 3"
            onClick={() => {
              if (!saveMutation.isPending) saveMutation.mutate({ tone, dailySendCap, followUpEnabled });
            }}
          />
        </div>
      </div>
    </div>
  );
}

/* ── Step 3: Gmail ──────────────────────────────────────────────── */

function GmailStep({ onFinish, onBack }: { onFinish: () => void; onBack: () => void }) {
  const user = useAuthStore((s) => s.user);
  return (
    <div className="space-y-6">
      <div className="rounded-card border border-graphite bg-ink-2 p-8 text-center">
        <div className="mx-auto flex size-14 items-center justify-center rounded-pill border border-graphite bg-ink">
          <Mail className="size-6 text-text-2-dark" />
        </div>
        <Mono size="sm" className="mt-4 block text-paper">
          Connect Gmail
        </Mono>
        <p className="mx-auto mt-1 max-w-sm font-sans text-sm font-normal text-text-2-dark">
          Emails are sent from your own Gmail account, with your resume attached — recruiters see you, not a tool.
        </p>
        <div className="mx-auto mt-6 w-full max-w-md text-left">
          <GmailConnectPanel />
        </div>
      </div>

      <div className="flex items-center justify-between pt-2">
        <Button type="button" variant="ghost" onClick={onBack}>
          <span aria-hidden>←</span>
          Back
        </Button>
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" onClick={onFinish}>
            Skip for now
          </Button>
          <Button type="button" onClick={onFinish}>
            {user?.gmailConnected && <Check className="size-4" />}
            Finish setup
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ── Wizard shell ───────────────────────────────────────────────── */

export function Onboarding() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [resumeUploaded, setResumeUploaded] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [skills, setSkills] = useState<string[]>([]);
  const [summary, setSummary] = useState('');

  const next = () => setStep((s) => Math.min(s + 1, STEPS.length - 1));
  const back = () => setStep((s) => Math.max(s - 1, 0));
  const finish = () => navigate('/dashboard', { replace: true });

  const current = STEPS[step];

  return (
    <div className="min-h-screen bg-ink text-paper">
      <div className="relative mx-auto flex min-h-screen w-full max-w-2xl flex-col px-6 py-10">
        <div className="mb-10 flex items-center justify-between">
          <Logo />
          <button
            type="button"
            onClick={finish}
            className="focus-ring rounded-btn font-sans text-sm text-text-2-dark transition-quick hover:text-paper"
          >
            I’ll do this later
          </button>
        </div>

        <StepIndicator current={step} />

        <div className="mt-8 rounded-card border border-graphite bg-ink-2 p-6 animate-fade-in">
          <div className="mb-6 flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-btn border border-graphite bg-ink">
              <current.icon className="size-5 text-text-2-dark" />
            </div>
            <div>
              <h2 className="font-sans text-subheading font-normal text-paper">
                {current.title}.
              </h2>
              <p className="font-sans text-sm text-text-2-dark">
                {step === 0 && 'Upload your resume and confirm your profile.'}
                {step === 1 && 'How should your emails sound, and how many per day?'}
                {step === 2 && 'The last piece — where your emails are sent from.'}
              </p>
            </div>
          </div>

          {step === 0 && (
            <ProfileStep
              uploaded={resumeUploaded}
              skills={skills}
              summary={summary}
              fileName={fileName}
              onSkillsChange={setSkills}
              onSummaryChange={setSummary}
              onUploaded={(parsedSkills, parsedSummary, meta) => {
                setResumeUploaded(true);
                setSkills(parsedSkills);
                setSummary(parsedSummary);
                setFileName(meta.originalName);
              }}
              onContinue={next}
            />
          )}
          {step === 1 && <ToneStep onContinue={next} onBack={back} />}
          {step === 2 && <GmailStep onFinish={finish} onBack={back} />}
        </div>
      </div>
    </div>
  );
}
