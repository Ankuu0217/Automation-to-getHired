import { zodResolver } from '@hookform/resolvers/zod';
import { profileUpdateSchema, type UpdateProfileInput } from '@jobmail/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileText, Loader2, ShieldAlert, UploadCloud } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useDropzone, type FileRejection } from 'react-dropzone';
import { useForm } from 'react-hook-form';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';

import { GmailConnectPanel } from '@/components/GmailConnect';
import { Mono } from '@/components/Mono';
import { SkillsEditor } from '@/components/SkillsEditor';
import { AlertDialog } from '@/components/ui/alert-dialog';
import { ArrowSquare } from '@/components/ui/arrow-square';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  ApiRequestError,
  deleteAccount,
  downloadResumeUrl,
  getProfile,
  me,
  updateProfile,
  updateSettings,
  uploadResume,
} from '@/lib/api';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth';

const SECTIONS = [
  { id: 'profile', label: 'Profile' },
  { id: 'gmail', label: 'Gmail' },
  { id: 'sending', label: 'Sending' },
  { id: 'signature', label: 'Signature' },
  { id: 'danger', label: 'Danger zone' },
] as const;

const MAX_RESUME_BYTES = 10 * 1024 * 1024;

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiRequestError ? error.message : fallback;
}

/* ── Sub-nav ─────────────────────────────────────────────────────────────── */

function SubNav() {
  return (
    <nav className="sticky top-24 hidden w-40 shrink-0 flex-col gap-1 lg:flex">
      {SECTIONS.map((section) => (
        <a
          key={section.id}
          href={`#${section.id}`}
          className="focus-ring rounded-nav px-3 py-2 font-mono text-[13px] uppercase tracking-[-0.02em] text-text-2-dark transition-quick hover:bg-ink-3 hover:text-paper"
        >
          {section.label}
        </a>
      ))}
    </nav>
  );
}

/* ── Profile & résumé ────────────────────────────────────────────────────── */

function relativeUploadDate(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days < 31) return `${days} day${days === 1 ? '' : 's'} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
  const years = Math.floor(days / 365);
  return `${years} year${years === 1 ? '' : 's'} ago`;
}

function ResumeCard() {
  const queryClient = useQueryClient();
  const profileQuery = useQuery({ queryKey: ['profile'], queryFn: getProfile });
  const resumeFile = profileQuery.data?.profile.resumeFile ?? null;

  const uploadMutation = useMutation({
    mutationFn: uploadResume,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profile'] });
      toast.success('Résumé updated.');
    },
    onError: (error) => toast.error(errorMessage(error, 'Could not parse that PDF.')),
  });

  const onDrop = (accepted: File[], rejected: FileRejection[]) => {
    if (rejected.length > 0) {
      const reason = rejected[0]?.errors[0];
      toast.error(
        reason?.code === 'file-too-large'
          ? 'File too large — resumes must be 10 MB or less.'
          : 'PDF only — export your resume as a PDF first.',
      );
      return;
    }
    if (accepted[0]) uploadMutation.mutate(accepted[0]);
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/pdf': ['.pdf'] },
    maxSize: MAX_RESUME_BYTES,
    multiple: false,
  });

  return (
    <div className="rounded-card border border-graphite bg-ink-2 p-6">
      {profileQuery.isPending ? (
        <div className="space-y-3">
          <Skeleton className="h-5 w-56 bg-ink-3" />
          <Skeleton className="h-24 w-full bg-ink-3" />
        </div>
      ) : (
        <div className="space-y-4">
          {resumeFile ? (
            <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
              <div className="min-w-0">
                <p className="flex items-center gap-2 font-sans text-sm font-normal text-paper">
                  <FileText className="size-4 shrink-0 text-text-2-dark" />
                  <span className="truncate">{resumeFile.originalName}</span>
                </p>
                <p className="mt-1 font-sans text-xs text-text-3-dark">
                  Uploaded {relativeUploadDate(resumeFile.uploadedAt)}
                </p>
              </div>
              <a
                href={downloadResumeUrl()}
                download
                className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'shrink-0')}
              >
                <Download className="size-4" />
                Download
              </a>
            </div>
          ) : (
            <p className="font-sans text-sm font-normal text-text-2-dark">
              No résumé yet — upload a PDF and it rides along with every outreach email.
            </p>
          )}

          <div
            {...getRootProps()}
            className={cn(
              'focus-ring flex cursor-pointer flex-col items-center gap-3 rounded-btn border border-dashed px-6 py-8 text-center transition-quick',
              isDragActive ? 'border-lime bg-ink' : 'border-graphite bg-ink hover:border-text-3-dark',
              uploadMutation.isPending && 'pointer-events-none opacity-60',
            )}
          >
            <input
              {...getInputProps()}
              aria-label={resumeFile ? 'Replace résumé' : 'Upload résumé'}
            />
            {uploadMutation.isPending ? (
              <Mono size="sm" className="text-paper">Parsing…</Mono>
            ) : (
              <UploadCloud className="size-8 text-text-2-dark" />
            )}
            <div>
              <p className="font-sans text-sm font-normal text-paper">
                {uploadMutation.isPending
                  ? 'Parsing your resume…'
                  : resumeFile
                    ? 'Drop a new PDF here to replace your résumé, or click to browse'
                    : 'Drop your resume PDF here, or click to browse'}
              </p>
              <Mono size="xs" color="fog" className="mt-1">
                PDF only, up to 10 MB
              </Mono>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ProfileField({
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

function ProfileDetailsCard() {
  const queryClient = useQueryClient();
  const profileQuery = useQuery({ queryKey: ['profile'], queryFn: getProfile });
  const [skills, setSkills] = useState<string[]>([]);
  const [preferredRoles, setPreferredRoles] = useState<string[]>([]);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<UpdateProfileInput>({
    resolver: zodResolver(profileUpdateSchema),
    defaultValues: {
      fullName: '',
      headline: '',
      links: { linkedin: '', github: '', portfolio: '' },
      summary: '',
      noticePeriod: '',
      currentCTC: '',
      expectedCTC: '',
    },
  });

  useEffect(() => {
    if (!profileQuery.data) return;
    const p = profileQuery.data.profile;
    reset({
      fullName: p.fullName,
      headline: p.headline,
      links: { linkedin: p.links.linkedin, github: p.links.github, portfolio: p.links.portfolio },
      summary: p.summary,
      noticePeriod: p.noticePeriod,
      currentCTC: p.currentCTC,
      expectedCTC: p.expectedCTC,
    });
    setSkills(p.skills);
    setPreferredRoles(p.preferredRoles);
  }, [profileQuery.data, reset]);

  const saveMutation = useMutation({
    mutationFn: updateProfile,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profile'] });
      toast.success('Profile saved.');
    },
    onError: (error) => toast.error(errorMessage(error, 'Could not save your profile.')),
  });

  const onSubmit = (values: UpdateProfileInput) => {
    saveMutation.mutate({ ...values, skills, preferredRoles });
  };

  return (
    <div className="rounded-card border border-graphite bg-ink-2 p-6">
      {profileQuery.isPending ? (
        <div className="space-y-3">
          <Skeleton className="h-9 w-full bg-ink-3" />
          <Skeleton className="h-9 w-full bg-ink-3" />
          <Skeleton className="h-28 w-full bg-ink-3" />
        </div>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <ProfileField label="Full name" error={errors.fullName?.message}>
              <Input placeholder="Ada Lovelace" {...register('fullName')} />
            </ProfileField>
            <ProfileField label="Headline" error={errors.headline?.message}>
              <Input placeholder="Backend Engineer · Node.js · Fintech" {...register('headline')} />
            </ProfileField>
          </div>

          <ProfileField label="Skills">
            <SkillsEditor skills={skills} onChange={setSkills} />
          </ProfileField>

          <ProfileField label="Preferred roles">
            <SkillsEditor
              skills={preferredRoles}
              onChange={setPreferredRoles}
              max={20}
              maxMessage="Maximum of 20 roles."
              placeholder="Add a role (e.g. Backend Engineer) and press Enter"
              emptyLabel="No preferred roles yet — add a few below."
              addLabel="Add role"
            />
          </ProfileField>

          <ProfileField label="LinkedIn URL" error={errors.links?.linkedin?.message}>
            <Input placeholder="https://linkedin.com/in/…" {...register('links.linkedin')} />
          </ProfileField>

          <div className="grid gap-4 sm:grid-cols-2">
            <ProfileField label="GitHub URL" error={errors.links?.github?.message}>
              <Input placeholder="https://github.com/…" {...register('links.github')} />
            </ProfileField>
            <ProfileField label="Portfolio URL" error={errors.links?.portfolio?.message}>
              <Input placeholder="https://…" {...register('links.portfolio')} />
            </ProfileField>
          </div>

          <ProfileField label="Professional summary" error={errors.summary?.message}>
            <Textarea
              rows={5}
              placeholder="A short paragraph on who you are and what you do best."
              {...register('summary')}
            />
          </ProfileField>

          <div className="grid gap-4 sm:grid-cols-3">
            <ProfileField label="Notice period" error={errors.noticePeriod?.message}>
              <Input placeholder="30 days" {...register('noticePeriod')} />
            </ProfileField>
            <ProfileField label="Current CTC" error={errors.currentCTC?.message}>
              <Input placeholder="₹18 LPA" {...register('currentCTC')} />
            </ProfileField>
            <ProfileField label="Expected CTC" error={errors.expectedCTC?.message}>
              <Input placeholder="₹24 LPA" {...register('expectedCTC')} />
            </ProfileField>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button type="submit" disabled={saveMutation.isPending}>
              {saveMutation.isPending && <Loader2 className="size-4 animate-spin" />}
              Save profile
            </Button>
            <ArrowSquare
              decorative
              disabled={saveMutation.isPending}
              onClick={() => void handleSubmit(onSubmit)()}
            />
          </div>
        </form>
      )}
    </div>
  );
}

function ProfileSection() {
  return (
    <section id="profile" className="scroll-mt-28">
      <div className="mb-4">
        <Mono size="xs" color="fog">
          Candidate
        </Mono>
        <h2 className="mt-1 font-sans text-heading text-paper">
          Profile & résumé.
        </h2>
        <p className="mt-2 max-w-lg font-sans text-base font-normal text-text-2-dark">
          What your outreach knows about you — the résumé attached to every email, and the details
          used to draft it.
        </p>
      </div>
      <div className="space-y-6">
        <ResumeCard />
        <ProfileDetailsCard />
      </div>
    </section>
  );
}

/* ── Gmail connection ────────────────────────────────────────────────────── */

function GmailSection() {
  return (
    <section id="gmail" className="scroll-mt-28">
      <div className="mb-4">
        <Mono size="xs" color="fog">
          Connection
        </Mono>
        <h2 className="mt-1 font-sans text-heading text-paper">
          Gmail account.
        </h2>
        <p className="mt-2 max-w-lg font-sans text-base font-normal text-text-2-dark">
          Outreach is sent from your own Gmail account, so recruiters see you — not a tool.
        </p>
      </div>
      <GmailConnectPanel />
    </section>
  );
}

/* ── Sending preferences ─────────────────────────────────────────────────── */

function SendingSection() {
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const [autoSend, setAutoSend] = useState(user?.settings.autoSend ?? false);
  const [followUpEnabled, setFollowUpEnabled] = useState(user?.settings.followUpEnabled ?? true);
  const [dailySendCap, setDailySendCap] = useState(user?.settings.dailySendCap ?? 30);

  useEffect(() => {
    if (!user) return;
    setAutoSend(user.settings.autoSend);
    setFollowUpEnabled(user.settings.followUpEnabled);
    setDailySendCap(user.settings.dailySendCap);
  }, [user]);

  const saveMutation = useMutation({
    mutationFn: updateSettings,
    onSuccess: (data) => {
      setUser(data.user);
      toast.success('Sending preferences saved.');
    },
    onError: (error) => toast.error(errorMessage(error, 'Could not save preferences.')),
  });

  return (
    <section id="sending" className="scroll-mt-28">
      <div className="mb-4">
        <Mono size="xs" color="fog">
          Guardrails
        </Mono>
        <h2 className="mt-1 font-sans text-heading text-paper">
          Sending controls.
        </h2>
        <p className="mt-2 max-w-lg font-sans text-base font-normal text-text-2-dark">
          Hard limits that keep your Gmail reputation safe and your outreach human.
        </p>
      </div>

      <div className="space-y-6 rounded-card border border-graphite bg-ink-2 p-6">
        {/* Daily cap */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label htmlFor="settings-daily-cap" className="font-mono text-[13px] uppercase tracking-[-0.02em]">
              Daily send cap
            </Label>
            <Mono size="xs" color="pure">
              {dailySendCap} / DAY
            </Mono>
          </div>
          <Slider
            id="settings-daily-cap"
            min={1}
            max={100}
            value={dailySendCap}
            onChange={(e) => setDailySendCap(Number(e.target.value))}
            aria-label="Daily send cap"
          />
          <p className="font-sans text-xs text-text-3-dark">
            Hard limit per day, with 2–8 minute human-like jitter between sends and a 10/hour ceiling.
            Overflow rolls to the next morning.
          </p>
        </div>

        <Separator />

        {/* Auto-send */}
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <Label htmlFor="settings-auto-send">Auto-send without review</Label>
            <p className="font-sans text-xs text-text-3-dark">Off by default — every email waits for your explicit approval.</p>
            {autoSend && (
              <div className="mt-3 rounded-btn border border-warn/40 bg-transparent p-3">
                <Mono size="xs" color="warn" className="leading-relaxed">
                  Auto-send emails go out without your review. Keep the daily cap low and your targeting tight.
                </Mono>
              </div>
            )}
          </div>
          <Switch
            id="settings-auto-send"
            checked={autoSend}
            onCheckedChange={setAutoSend}
            aria-label="Auto-send without review"
          />
        </div>

        <Separator />

        {/* Follow-ups */}
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <Label htmlFor="settings-follow-ups">Automatic follow-ups</Label>
            <p className="font-sans text-xs text-text-3-dark">
              A short nudge on day 3 and day 7 when there’s no reply. Stops on reply, bounce, or a stage change.
            </p>
          </div>
          <Switch
            id="settings-follow-ups"
            checked={followUpEnabled}
            onCheckedChange={setFollowUpEnabled}
            aria-label="Automatic follow-ups"
          />
        </div>

        <div className="flex justify-end pt-2">
          <Button
            onClick={() => saveMutation.mutate({ autoSend, followUpEnabled, dailySendCap })}
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending && <Loader2 className="size-4 animate-spin" />}
            Save preferences
            <span aria-hidden>→</span>
          </Button>
        </div>
      </div>
    </section>
  );
}

/* ── Signature ───────────────────────────────────────────────────────────── */

function SignatureSection() {
  const queryClient = useQueryClient();
  const profileQuery = useQuery({ queryKey: ['profile'], queryFn: getProfile });
  const [signature, setSignature] = useState('');

  useEffect(() => {
    if (profileQuery.data) setSignature(profileQuery.data.profile.signature ?? '');
  }, [profileQuery.data]);

  const saveMutation = useMutation({
    mutationFn: () => updateProfile({ signature }),
    onSuccess: (data) => {
      queryClient.setQueryData(['profile'], data);
      toast.success('Signature saved.');
    },
    onError: (error) => toast.error(errorMessage(error, 'Could not save your signature.')),
  });

  return (
    <section id="signature" className="scroll-mt-28">
      <div className="mb-4">
        <Mono size="xs" color="fog">
          Identity
        </Mono>
        <h2 className="mt-1 font-sans text-heading text-paper">
          Email signature.
        </h2>
        <p className="mt-2 max-w-lg font-sans text-base font-normal text-text-2-dark">
          Appended to every generated email. Your name, phone, and links from your profile are a good default.
        </p>
      </div>

      <div className="rounded-card border border-graphite bg-ink-2 p-6">
        {profileQuery.isPending ? (
          <div className="space-y-3">
            <Skeleton className="h-28 w-full bg-ink-3" />
            <Skeleton className="h-9 w-32 bg-ink-3" />
          </div>
        ) : (
          <div className="space-y-4">
            <Textarea
              rows={5}
              value={signature}
              onChange={(e) => setSignature(e.target.value)}
              placeholder={'Ada Lovelace\n+91 98765 43210\nhttps://linkedin.com/in/ada'}
              aria-label="Email signature"
            />
            <div className="flex justify-end">
              <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
                {saveMutation.isPending && <Loader2 className="size-4 animate-spin" />}
                Save signature
                <span aria-hidden>→</span>
              </Button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

/* ── Danger zone ─────────────────────────────────────────────────────────── */

function DangerSection() {
  const navigate = useNavigate();
  const clear = useAuthStore((s) => s.clear);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const deleteMutation = useMutation({
    mutationFn: deleteAccount,
    onSuccess: () => {
      clear();
      toast.success('Your account and all data have been deleted.');
      navigate('/', { replace: true });
    },
    onError: (error) => toast.error(errorMessage(error, 'Could not delete account.')),
  });

  const handleDelete = () => setDeleteOpen(true);

  return (
    <section id="danger" className="scroll-mt-28">
      <div className="mb-4">
        <Mono size="xs" color="danger">
          Irreversible
        </Mono>
        <h2 className="mt-1 font-sans text-heading text-paper">
          Danger zone.
        </h2>
      </div>

      <div className="rounded-card border border-danger/40 bg-transparent p-6">
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <div className="min-w-0">
            <p className="flex items-center gap-2 font-sans text-sm font-normal text-paper">
              <ShieldAlert className="size-4 text-danger" />
              Delete account & all data
            </p>
            <p className="mt-1 font-sans text-xs text-text-3-dark">
              Wipes your profile, resumes, applications, templates, tracking events, and revokes Gmail access.
              Cannot be undone.
            </p>
          </div>
          <Button
            variant="destructive"
            size="sm"
            onClick={handleDelete}
            disabled={deleteMutation.isPending}
          >
            {deleteMutation.isPending && <Loader2 className="size-4 animate-spin" />}
            Delete everything
          </Button>
        </div>
      </div>

      <AlertDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete account & all data?"
        description="This permanently removes your profile, resumes, job posts, applications, templates, and tracking events, and revokes Gmail access. This cannot be undone."
        confirmLabel="Delete everything"
        destructive
        onConfirm={() => {
          setDeleteOpen(false);
          deleteMutation.mutate();
        }}
      />
    </section>
  );
}

/* ── Colophon ────────────────────────────────────────────────────────────── */

function Colophon() {
  return (
    <footer className="border-t border-graphite pt-8">
      <Mono size="xs" color="fog">
        GETHIRED · COLD OUTREACH AUTOPILOT · BUILT QUIETLY
      </Mono>
      <p className="mt-1 font-sans text-xs text-text-3-dark">
        Your data stays yours. Tokens are encrypted at rest; you can disconnect Gmail anytime.
      </p>
    </footer>
  );
}

/* ── Page ────────────────────────────────────────────────────────────────── */

export function Settings() {
  const [searchParams, setSearchParams] = useSearchParams();
  const setUser = useAuthStore((s) => s.setUser);

  /* OAuth callback lands here with ?gmail=connected|denied|error. */
  useEffect(() => {
    const gmail = searchParams.get('gmail');
    if (!gmail) return;
    if (gmail === 'connected') {
      toast.success('Gmail connected — outreach will be sent from your account.');
      me()
        .then(({ user }) => setUser(user))
        .catch(() => undefined);
    } else if (gmail === 'denied') {
      toast.warning('Gmail access was denied — you can connect anytime from Settings.');
    } else {
      toast.error('Gmail connection failed — please try again.');
    }
    setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams, setUser]);

  return (
    <div className="flex gap-12">
      <SubNav />
      <div className="min-w-0 max-w-2xl flex-1 space-y-16">
        <div>
          <Mono size="xs" color="fog">
            Account
          </Mono>
          <h1 className="mt-1 font-sans text-heading text-paper">
            Your settings.
          </h1>
        </div>

        <ProfileSection />
        <GmailSection />
        <SendingSection />
        <SignatureSection />
        <DangerSection />
        <Colophon />
      </div>
    </div>
  );
}
