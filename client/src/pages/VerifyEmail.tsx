import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Loader2, MailWarning } from 'lucide-react';
import { useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { AuthLayout } from '@/components/AuthLayout';
import { Mono } from '@/components/Mono';
import { buttonVariants } from '@/components/ui/button';
import { ApiRequestError, verifyEmail } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth';

/**
 * Public landing for the emailed verification link (`/verify-email?token=…`).
 * The token is the proof, so this works with or without a session — the verify
 * call runs once on mount, then one of three states renders: verifying /
 * verified / bad link.
 *
 * Uses useQuery (not a fire-once useEffect + useMutation): the query is keyed by
 * the token and deduped by react-query, so it survives StrictMode's dev
 * mount→unmount→remount cleanly and reliably reflects success/error. `retry:
 * false` — a bad/used token must surface immediately, not spin.
 */
export function VerifyEmail() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const setUser = useAuthStore((s) => s.setUser);

  const query = useQuery({
    queryKey: ['verify-email', token],
    queryFn: () => verifyEmail({ token }),
    enabled: token.length > 0,
    retry: false,
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  // Warm the store once verified so an in-browser session immediately drops the
  // "verify" banner. A cross-device visitor just gets a primed store and signs in.
  const verifiedUser = query.data?.user;
  useEffect(() => {
    if (verifiedUser) setUser(verifiedUser);
  }, [verifiedUser, setUser]);

  /* ── Verified ── */
  if (query.isSuccess) {
    return (
      <AuthLayout>
        <div className="flex flex-col items-center text-center">
          <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-ok/10">
            <CheckCircle2 className="size-6 text-ok" />
          </div>
          <Mono size="xs" color="fog">
            Email verified
          </Mono>
          <h1 className="mt-1 font-sans text-subheading font-normal text-paper">You’re all set.</h1>
          <p className="mt-2 font-sans text-sm text-text-2-dark">
            Your email is confirmed — outreach sending is now unlocked.
          </p>
          <Link to="/dashboard" className={cn(buttonVariants({ size: 'lg' }), 'mt-6 w-full')}>
            Go to dashboard
          </Link>
          <Link
            to="/login"
            className="focus-ring mt-4 rounded-btn font-mono text-[13px] uppercase tracking-[-0.02em] text-text-2-dark underline-offset-4 hover:text-paper hover:underline"
          >
            Back to sign in
          </Link>
        </div>
      </AuthLayout>
    );
  }

  /* ── Bad link (missing / invalid / expired) ── */
  if (query.isError || !token) {
    const message =
      !token
        ? 'This verification link is missing its token.'
        : query.error instanceof ApiRequestError
          ? query.error.message
          : 'We couldn’t verify this link. Please try again.';

    return (
      <AuthLayout>
        <div className="flex flex-col items-center text-center">
          <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-warn/10">
            <MailWarning className="size-6 text-warn" />
          </div>
          <Mono size="xs" color="fog">
            Verification
          </Mono>
          <h1 className="mt-1 font-sans text-subheading font-normal text-paper">
            This link didn’t work.
          </h1>
          <p className="mt-2 font-sans text-sm text-text-2-dark">{message}</p>
          <p className="mt-2 font-sans text-sm text-text-2-dark">
            Sign in and use the “Resend” button on the banner to get a fresh link.
          </p>
          <Link to="/login" className={cn(buttonVariants({ size: 'lg' }), 'mt-6 w-full')}>
            Go to sign in
          </Link>
        </div>
      </AuthLayout>
    );
  }

  /* ── Verifying (initial + in-flight) ── */
  return (
    <AuthLayout>
      <div className="flex flex-col items-center py-4 text-center">
        <Loader2 className="size-6 animate-spin text-lime" />
        <p className="mt-4 font-sans text-sm text-text-2-dark">Verifying your email…</p>
      </div>
    </AuthLayout>
  );
}
