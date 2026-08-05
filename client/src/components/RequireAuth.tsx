import { Loader2 } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

import { Logo } from '@/components/Logo';
import { Mono } from '@/components/Mono';
import { me } from '@/lib/api';
import { useAuthStore } from '@/stores/auth';

function FullPageLoader() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background">
      <Logo />
      <div className="flex items-center gap-2 font-sans text-sm text-text-2">
        <Loader2 className="size-4 animate-spin text-cyan" />
        <Mono size="xs" color="fog">Loading your workspace…</Mono>
      </div>
    </div>
  );
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { status, setUser, clear } = useAuthStore();
  const location = useLocation();

  useEffect(() => {
    if (status !== 'loading') return;
    let cancelled = false;
    me()
      .then(({ user }) => {
        if (!cancelled) setUser(user);
      })
      .catch(() => {
        if (!cancelled) clear();
      });
    return () => {
      cancelled = true;
    };
  }, [status, setUser, clear]);

  if (status === 'loading') return <FullPageLoader />;
  if (status === 'unauthenticated') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}
