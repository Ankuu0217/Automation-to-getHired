import { ErrorCodes } from '@jobmail/shared';
import { useMutation } from '@tanstack/react-query';
import { Loader2, Mail, Unplug } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { AlertDialog } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Mono } from '@/components/Mono';
import { ApiRequestError, connectGmail, disconnectGmail, me } from '@/lib/api';
import { useAuthStore } from '@/stores/auth';
import { cn } from '@/lib/utils';

/**
 * Shared Gmail connect/status panel (M3) — used by Settings and the
 * Onboarding Gmail step. Connect navigates away to the Google consent URL;
 * the OAuth callback lands back on /settings?gmail=connected|denied|error.
 */
export function GmailConnectPanel() {
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const [oauthMissing, setOauthMissing] = useState(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);

  const connectMutation = useMutation({
    mutationFn: connectGmail,
    onSuccess: (data) => {
      window.location.href = data.url;
    },
    onError: (error) => {
      if (error instanceof ApiRequestError && error.code === ErrorCodes.OAUTH_NOT_CONFIGURED) {
        setOauthMissing(true);
        return;
      }
      toast.error(error instanceof ApiRequestError ? error.message : 'Could not start Gmail connect.');
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: disconnectGmail,
    onSuccess: async () => {
      try {
        const { user: fresh } = await me();
        setUser(fresh);
      } catch {
        // Non-fatal — the next /auth/me refresh picks it up.
      }
      toast.success('Gmail disconnected.');
    },
    onError: (error) => {
      toast.error(error instanceof ApiRequestError ? error.message : 'Could not disconnect Gmail.');
    },
  });

  const status = user?.gmailStatus ?? 'disconnected';
  const connected = status === 'connected';
  const needsReconnect = status === 'needs_reconnect';
  const linked = connected || needsReconnect; // an address is on file in both cases

  // A needs_reconnect grant can heal on its own (a later send/retry succeeds and
  // clears the flag server-side). Refetch /auth/me on window focus while flagged
  // so the amber state clears without a hard reload.
  useEffect(() => {
    if (status !== 'needs_reconnect') return;
    const refresh = () => {
      me()
        .then(({ user: fresh }) => setUser(fresh))
        .catch(() => undefined);
    };
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [status, setUser]);

  const handleDisconnect = () => setDisconnectOpen(true);

  return (
    <div className="space-y-3">
      <div
        className={cn(
          'flex flex-col items-start justify-between gap-4 rounded-card border p-4 sm:flex-row sm:items-center',
          needsReconnect
            ? 'border-warn/40 bg-warn/5'
            : linked
              ? 'border-graphite bg-ink-2'
              : 'border-graphite bg-ink',
        )}
      >
        <div className="flex items-center gap-3">
          <div
            className={cn(
              'flex size-10 shrink-0 items-center justify-center rounded-btn border',
              needsReconnect
                ? 'border-warn/40 text-warn'
                : connected
                  ? 'border-ok/40 text-ok'
                  : 'border-graphite bg-ink-2 text-text-3-dark',
            )}
          >
            <Mail className="size-5" />
          </div>
          <div className="min-w-0">
            <p className="font-sans text-sm font-normal text-paper">
              {linked ? user?.connectedEmail : 'Not connected'}
            </p>
            <p className="font-sans text-xs text-text-2-dark">
              {needsReconnect
                ? 'Connection expired — reconnect to resume sending.'
                : connected
                  ? 'You’ll send outreach as this address.'
                  : 'Tokens are encrypted at rest; you can revoke access anytime.'}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {linked ? (
            <>
              <Badge variant={needsReconnect ? 'warning' : 'success'}>
                {needsReconnect ? 'Reconnect needed' : 'Connected'}
              </Badge>
              {needsReconnect && (
                <Button
                  size="sm"
                  onClick={() => connectMutation.mutate()}
                  disabled={connectMutation.isPending}
                >
                  {connectMutation.isPending && <Loader2 className="size-4 animate-spin" />}
                  {connectMutation.isPending ? 'Redirecting…' : 'Reconnect'}
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={handleDisconnect}
                disabled={disconnectMutation.isPending}
              >
                {disconnectMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Unplug className="size-4" />}
                Disconnect
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              onClick={() => connectMutation.mutate()}
              disabled={connectMutation.isPending}
            >
              {connectMutation.isPending && <Loader2 className="size-4 animate-spin" />}
              {connectMutation.isPending ? 'Redirecting…' : 'Connect Gmail'}
              <span aria-hidden>→</span>
            </Button>
          )}
        </div>
      </div>

      <AlertDialog
        open={disconnectOpen}
        onOpenChange={setDisconnectOpen}
        title="Disconnect Gmail?"
        description="Sending will stop until you reconnect."
        confirmLabel="Disconnect"
        destructive
        onConfirm={() => {
          setDisconnectOpen(false);
          disconnectMutation.mutate();
        }}
      />

      {oauthMissing && !linked && (
        <div className="rounded-btn border border-warn/40 bg-transparent p-3">
          <Mono size="xs" color="warn" className="leading-relaxed">
            Gmail OAuth is not configured on this server. For local development, set the app-password
            fallback env vars instead (see server/.env.example).
          </Mono>
        </div>
      )}
    </div>
  );
}
