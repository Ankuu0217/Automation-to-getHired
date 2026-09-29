import { useMutation } from '@tanstack/react-query';
import { Copy, Puzzle } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Mono } from '@/components/Mono';
import { Button, buttonVariants } from '@/components/ui/button';
import { ApiRequestError, createExtensionToken, me, revokeExtensionToken } from '@/lib/api';
import { useAuthStore } from '@/stores/auth';

/** Link the GetHired Chrome extension: download, then a one-time token. */
export function ExtensionCard() {
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const [token, setToken] = useState<string | null>(null);
  const refresh = () => me().then(({ user: u }) => setUser(u)).catch(() => undefined);

  const create = useMutation({
    mutationFn: createExtensionToken,
    onSuccess: (r) => {
      setToken(r.token);
      void refresh();
    },
    onError: (e) => toast.error(e instanceof ApiRequestError ? e.message : 'Could not create a token.'),
  });
  const revoke = useMutation({
    mutationFn: revokeExtensionToken,
    onSuccess: () => {
      setToken(null);
      void refresh();
      toast.success('Extension disconnected.');
    },
  });
  const linked = Boolean(user?.extensionConnectedAt);

  return (
    <div className="space-y-3 rounded-card border border-graphite bg-ink-2 p-4">
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-btn border border-graphite text-text-2-dark">
          <Puzzle className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <Mono size="xs" color="fog">Chrome extension</Mono>
          <p className="mt-1 font-sans text-sm text-text-2-dark">
            On LinkedIn, select a post and right-click → <span className="text-paper">Send to GetHired</span> (or press Alt+Shift+G). It opens here with company, role and recruiter email filled in.
          </p>
          {linked && !token && (
            <Mono size="xs" color="cyan" className="mt-2 block">Linked · {new Date(user!.extensionConnectedAt!).toLocaleDateString()}</Mono>
          )}
        </div>
      </div>

      <ol className="list-decimal space-y-1 pl-5 font-sans text-sm text-text-2-dark">
        <li>Download the extension and unzip it.</li>
        <li>Open <span className="font-mono text-xs text-paper">chrome://extensions</span>, turn on Developer mode, click <span className="text-paper">Load unpacked</span> and pick the folder.</li>
        <li>Create a token below and paste it into the extension’s settings page.</li>
      </ol>

      <div className="flex flex-wrap gap-2">
        <a href="/gethired-extension.zip" download className={buttonVariants({ variant: 'outline', size: 'sm' })}>Download extension</a>
        <Button size="sm" onClick={() => create.mutate()} disabled={create.isPending}>
          {linked ? 'Create new token' : 'Create token'}
        </Button>
        {linked && (
          <Button variant="ghost" size="sm" onClick={() => revoke.mutate()} disabled={revoke.isPending}>Disconnect</Button>
        )}
      </div>

      {token && (
        <div className="space-y-1.5 rounded-btn border border-lime/40 p-3">
          <Mono size="xs" color="warn">Shown once — copy it now</Mono>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate font-mono text-xs text-paper">{token}</code>
            <Button
              size="sm"
              variant="outline"
              onClick={() => navigator.clipboard.writeText(token).then(() => toast.success('Token copied.'), () => toast.error('Copy failed — select it instead.'))}
            >
              <Copy className="size-4" /> Copy
            </Button>
          </div>
          <p className="font-sans text-xs text-text-3-dark">It can only send job posts to your account — it can’t send email or change settings. Creating a new one disconnects the old.</p>
        </div>
      )}
    </div>
  );
}
