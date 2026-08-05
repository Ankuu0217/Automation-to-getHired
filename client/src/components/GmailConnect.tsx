import { ErrorCodes } from '@jobmail/shared';
import { useMutation } from '@tanstack/react-query';
import { Loader2, Mail, Unplug } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

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

  const connected = user?.gmailConnected ?? false;

  const handleDisconnect = () => {
    if (window.confirm('Disconnect Gmail? Sending will stop until you reconnect.')) {
      disconnectMutation.mutate();
    }
  };

  return (
    <div className="space-y-3">
      <div
        className={cn(
          'flex flex-col items-start justify-between gap-4 rounded-[16px] border p-4 sm:flex-row sm:items-center',
          connected ? 'border-pure/[0.06] bg-graphite' : 'border-pure/[0.06] bg-obsidian',
        )}
      >
        <div className="flex items-center gap-3">
          <div
            className={cn(
              'flex size-10 shrink-0 items-center justify-center rounded-[8px] border',
              connected ? 'border-ok/30 bg-ok/10 text-ok' : 'border-pure/[0.06] bg-graphite text-fog',
            )}
          >
            <Mail className="size-5" />
          </div>
          <div className="min-w-0">
            <p className="font-sans text-sm font-normal text-cloud">
              {connected ? user?.connectedEmail : 'Not connected'}
            </p>
            <p className="font-sans text-xs text-fog">
              {connected
                ? 'Your Gmail account is connected.'
                : 'Tokens are encrypted at rest; you can revoke access anytime.'}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {connected ? (
            <>
              <Badge variant="success">Connected</Badge>
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

      {oauthMissing && !connected && (
        <div className="rounded-[8px] border border-warn/30 bg-warn/10 p-3">
          <Mono size="xs" color="warn" className="leading-relaxed">
            Gmail OAuth is not configured on this server. For local development, set the app-password
            fallback env vars instead (see server/.env.example).
          </Mono>
        </div>
      )}
    </div>
  );
}
