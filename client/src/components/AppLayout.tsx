import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, Outlet } from 'react-router-dom';

import { Nav } from '@/components/Nav';
import { listApplications } from '@/lib/api';
import { useAuthStore } from '@/stores/auth';

function GmailDisconnectedBanner() {
  const lastSendError = useAuthStore((s) => s.user?.lastSendError);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => setDismissed(false), [lastSendError]);

  if (!lastSendError || dismissed) return null;

  return (
    <div className="border-b border-danger/30 bg-danger/5">
      <div className="mx-auto flex w-full max-w-[1200px] items-center gap-3 px-6 py-2.5">
        <AlertTriangle className="size-4 shrink-0 text-danger" />
        <p className="min-w-0 flex-1 truncate font-mono text-[10px] uppercase tracking-[0.16px] text-danger">
          Wire down — reconnect Gmail · <span className="text-danger/70">{lastSendError}</span>
        </p>
        <Link
          to="/settings#gmail"
          className="shrink-0 font-sans text-xs font-normal text-danger underline-offset-4 hover:underline"
        >
          Reconnect
        </Link>
        <button
          type="button"
          aria-label="Dismiss banner"
          onClick={() => setDismissed(true)}
          className="shrink-0 rounded-[8px] p-1 text-danger/70 transition-quick hover:bg-danger/10 hover:text-danger"
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
    <div className="flex min-h-screen flex-col bg-obsidian text-pure">
      <Nav variant="app" sentToday={sentToday} dailyCap={dailyCap} />

      <GmailDisconnectedBanner />

      <main className="flex-1 pt-24">
        <div className="mx-auto w-full max-w-[1200px] px-6 pb-16">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
