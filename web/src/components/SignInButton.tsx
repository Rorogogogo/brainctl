import { LogIn, LogOut, UserRound } from 'lucide-react';
import { useRef, useState } from 'react';

import { refreshAuthStatus, useAuthStatus } from '../lib/auth-status.js';
import { Button } from './ui/button.js';
import { toast } from './ui/toast.js';

export default function SignInButton() {
  const { status } = useAuthStatus();
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function startSignIn() {
    setBusy(true);
    try {
      const res = await fetch('/api/auth/start', { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { url, state } = (await res.json()) as { url: string; state: string };
      window.open(url, '_blank', 'noopener,noreferrer');
      if (pollRef.current) clearInterval(pollRef.current);
      const stop = Date.now() + 5 * 60 * 1000;
      const finish = () => {
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = null;
      };
      pollRef.current = setInterval(async () => {
        try {
          const outcomeRes = await fetch(`/api/auth/outcome?state=${encodeURIComponent(state)}`);
          if (outcomeRes.ok) {
            const outcome = (await outcomeRes.json()) as
              | { status: 'pending' }
              | { status: 'success' }
              | { status: 'error'; message: string };
            if (outcome.status === 'success') {
              finish();
              await refreshAuthStatus();
              toast.success('Signed in to brainctl');
              return;
            }
            if (outcome.status === 'error') {
              finish();
              toast.error(`Sign-in failed: ${outcome.message}`);
              return;
            }
          } else if (outcomeRes.status === 404) {
            finish();
            toast.error('Sign-in failed: session expired. Please try again.');
            return;
          }
        } catch {
          // network blip; keep polling until the deadline
        }
        if (Date.now() > stop) {
          finish();
          toast.error('Sign-in timed out. Please try again.');
        }
      }, 2000);
    } catch (err) {
      toast.error(`Sign-in failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      await refreshAuthStatus();
      toast.success('Signed out');
    } finally {
      setBusy(false);
    }
  }

  if (!status) {
    return (
      <Button variant="outline" size="sm" disabled>
        …
      </Button>
    );
  }

  if (status.signedIn) {
    const email = status.user?.email;
    const displayName = status.user?.displayName;
    const avatarUrl = status.user?.avatarUrl;
    const firstName =
      displayName?.trim().split(/\s+/)[0] ??
      (email ? email.split('@')[0] : undefined) ??
      'Signed in';
    const tooltip = email ?? displayName ?? 'Signed in';
    return (
      <div className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-background px-2 text-sm font-medium text-foreground shadow-sm">
        {avatarUrl ? (
          <img src={avatarUrl} alt="" referrerPolicy="no-referrer" className="size-6 shrink-0 rounded-full object-cover" />
        ) : (
          <span className="grid size-6 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
            <UserRound size={14} />
          </span>
        )}
        <span className="max-w-[120px] truncate" title={tooltip}>{firstName}</span>
        {status.source === 'env' && (
          <span className="rounded bg-muted px-1 py-px text-[10px] font-medium text-muted-foreground" title="Token comes from BRAINCTL_API_TOKEN env var">
            env
          </span>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => void signOut()}
          disabled={busy || status.source === 'env'}
          title={status.source === 'env' ? 'Unset BRAINCTL_API_TOKEN to sign out' : 'Sign out'}
          className="ml-1 size-6"
        >
          <LogOut size={13} />
        </Button>
      </div>
    );
  }

  return (
    <Button variant="outline" size="sm" onClick={() => void startSignIn()} disabled={busy}>
      <LogIn size={14} />
      {busy ? 'Opening…' : 'Sign in'}
    </Button>
  );
}
