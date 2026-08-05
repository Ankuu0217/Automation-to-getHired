import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, ShieldAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';

import { GmailConnectPanel } from '@/components/GmailConnect';
import { Mono } from '@/components/Mono';
import { AlertDialog } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  ApiRequestError,
  deleteAccount,
  getProfile,
  me,
  updateProfile,
  updateSettings,
} from '@/lib/api';
import { useAuthStore } from '@/stores/auth';

const SECTIONS = [
  { id: 'gmail', label: 'Gmail' },
  { id: 'sending', label: 'Sending' },
  { id: 'signature', label: 'Signature' },
  { id: 'danger', label: 'Danger zone' },
] as const;

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
          className="focus-ring rounded-func px-3 py-2 font-mono text-[11px] uppercase tracking-[0.16px] text-text-2 transition-quick hover:bg-surface-2 hover:text-text-1"
        >
          {section.label}
        </a>
      ))}
    </nav>
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
        <h2 className="mt-1 font-display text-[38px] font-normal leading-[0.9] text-text-1">
          Gmail <span className="italic">account</span>
        </h2>
        <p className="mt-2 max-w-lg font-sans text-base font-normal text-text-2">
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
        <h2 className="mt-1 font-display text-[38px] font-normal leading-[0.9] text-text-1">
          Sending <span className="italic">controls</span>
        </h2>
        <p className="mt-2 max-w-lg font-sans text-base font-normal text-text-2">
          Hard limits that keep your Gmail reputation safe and your outreach human.
        </p>
      </div>

      <div className="space-y-6 rounded-card border border-border bg-surface p-6">
        {/* Daily cap */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label htmlFor="settings-daily-cap">Daily send cap</Label>
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
          <p className="font-sans text-xs text-text-3">
            Hard limit per day, with 2–8 minute human-like jitter between sends and a 10/hour ceiling.
            Overflow rolls to the next morning.
          </p>
        </div>

        <Separator />

        {/* Auto-send */}
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <Label htmlFor="settings-auto-send">Auto-send without review</Label>
            <p className="font-sans text-xs text-text-3">Off by default — every email waits for your explicit approval.</p>
            {autoSend && (
              <div className="mt-3 rounded-func border border-warn/30 bg-warn/10 p-3">
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
            <p className="font-sans text-xs text-text-3">
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
        <h2 className="mt-1 font-display text-[38px] font-normal leading-[0.9] text-text-1">
          Email <span className="italic">signature</span>
        </h2>
        <p className="mt-2 max-w-lg font-sans text-base font-normal text-text-2">
          Appended to every generated email. Your name, phone, and links from your profile are a good default.
        </p>
      </div>

      <div className="rounded-card border border-border bg-surface p-6">
        {profileQuery.isPending ? (
          <div className="space-y-3">
            <Skeleton className="h-28 w-full bg-surface-2" />
            <Skeleton className="h-9 w-32 bg-surface-2" />
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
        <h2 className="mt-1 font-display text-[38px] font-normal leading-[0.9] text-text-1">
          Danger <span className="italic">zone</span>
        </h2>
      </div>

      <div className="rounded-card border border-danger/30 bg-danger/5 p-6">
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <div className="min-w-0">
            <p className="flex items-center gap-2 font-sans text-sm font-normal text-text-1">
              <ShieldAlert className="size-4 text-danger" />
              Delete account & all data
            </p>
            <p className="mt-1 font-sans text-xs text-text-3">
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
    <footer className="border-t border-border pt-8">
      <Mono size="xs" color="fog">
        GETHIRED · COLD OUTREACH AUTOPILOT · BUILT QUIETLY
      </Mono>
      <p className="mt-1 font-sans text-xs text-text-3">
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
          <h1 className="mt-1 font-display text-[38px] font-normal leading-[0.9] text-text-1">
            Your <span className="italic">settings</span>
          </h1>
        </div>

        <GmailSection />
        <SendingSection />
        <SignatureSection />
        <DangerSection />
        <Colophon />
      </div>
    </div>
  );
}
