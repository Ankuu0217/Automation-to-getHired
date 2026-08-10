import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertTriangle, MailWarning, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, Outlet } from 'react-router-dom';
import { toast } from 'sonner';

import { Nav } from '@/components/Nav';
import { ApiRequestError, listApplications, resendVerification } from '@/lib/api';
import { useAuthStore } from '@/stores/auth';

function GmailDisconnectedBanner() {
  const lastSendError = useAuthStore((s) => s.user?.lastSendError);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => setDismissed(false), [lastSendError]);

  if (!lastSendError || dismissed) return null;

  return (
    <div className="border-b border-danger/40">
      <div className="mx-auto flex w-full max-w-[1200px] items-center gap-3 px-6 py-2.5">
        <AlertTriangle className="size-4 shrink-0 text-danger" />
        <p className="min-w-0 flex-1 truncate font-mono text-[10px] uppercase tracking-[0.16px] text-danger">
          Sending paused — reconnect Gmail · <span className="text-danger/70">{lastSendError}</span>
        </p>
        <Link
          to="/settings#gmail"
          className="focus-ring shrink-0 rounded-btn font-sans text-xs font-normal text-danger underline-offset-4 hover:underline"
        >
          Reconnect
        </Link>
        <button
          type="button"
          aria-label="Dismiss banner"
          onClick={() => setDismissed(true)}
          className="focus-ring shrink-0 rounded-btn p-1 text-danger/70 transition-quick hover:bg-danger/10 hover:text-danger"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

/**
 * Sending-gate reminder: the account can log in, onboard and connect Gmail,
 * but the send pipeline is blocked until the email is verified. Amber (warn),
 * not danger — it's an action to take, not a failure. Dismiss hides it for the
 * session; Resend is throttled client-side to mirror the server's 60s cooldown.
 */
function VerifyEmailBanner() {
  const emailVerified = useAuthStore((s) => s.user?.emailVerified);
  const email = useAuthStore((s) => s.user?.email);
  const [dismissed, setDismissed] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((s) => (s <= 1 ? 0 : s - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  const resend = useMutation({
    mutationFn: resendVerification,
    onSuccess: () => {
      toast.success('Verification email sent — check your inbox.');
      setCooldown(60);
    },
    onError: (error) => {
      // The server enforces the same 60s window — reflect it in the button either way.
      if (error instanceof ApiRequestError && error.code === 'RATE_LIMITED') {
        toast.error('Please wait a minute before requesting another verification email.');
        setCooldown(60);
        return;
      }
      toast.error(error instanceof ApiRequestError ? error.message : 'Could not resend the email.');
    },
  });

  // Only unverified accounts see this. `undefined` (pre-feature sessions) reads
  // as "not unverified" so grandfathered users are never nagged.
  if (emailVerified !== false || dismissed) return null;

  const busy = resend.isPending || cooldown > 0;

  return (
    <div className="border-b border-warn/40 bg-warn/5">
      <div className="mx-auto flex w-full max-w-[1200px] items-center gap-3 px-6 py-2.5">
        <MailWarning className="size-4 shrink-0 text-warn" />
        <p className="min-w-0 flex-1 truncate font-mono text-[10px] uppercase tracking-[0.16px] text-warn">
          Verify your email to start sending
          {email ? (
            <>
              {' · '}
              <span className="text-warn/70">{email}</span>
            </>
          ) : null}
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={() => resend.mutate()}
          className="focus-ring shrink-0 rounded-btn font-sans text-xs font-normal text-warn underline-offset-4 hover:underline disabled:cursor-not-allowed disabled:opacity-50 disabled:no-underline"
        >
          {resend.isPending ? 'Sending…' : cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend'}
        </button>
        <button
          type="button"
          aria-label="Dismiss banner"
          onClick={() => setDismissed(true)}
          className="focus-ring shrink-0 rounded-btn p-1 text-warn/70 transition-quick hover:bg-warn/10 hover:text-warn"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

export function AppLayout() {
  const user = useAuthStore((s) => s.user);
  const applicationsQuery = useQuery({ queryKey: ['applications'], queryFn: listApplications });

  const sentToday = useMemo(() => {
    const apps = applicationsQuery.data?.applications ?? [];
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return apps.filter((app) => {
      const sentAt = app.lastEmail?.sentAt;
      return sentAt ? new Date(sentAt) >= start : false;
    }).length;
  }, [applicationsQuery.data]);

  const dailyCap = user?.settings.dailySendCap ?? 30;

  return (
    <div className="flex min-h-screen flex-col bg-ink text-paper">
      <Nav sentToday={sentToday} dailyCap={dailyCap} />

      {/* pt-16 clears the fixed 64px header so the banners are visible below it */}
      <div className="pt-16">
        <VerifyEmailBanner />
        <GmailDisconnectedBanner />
      </div>

      <main className="flex-1 pt-8">
        <div className="mx-auto w-full max-w-[1200px] px-6 pb-16">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
