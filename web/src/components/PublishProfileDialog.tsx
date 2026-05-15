import * as Dialog from '@radix-ui/react-dialog';
import { LoaderCircle, LogIn, UploadCloud } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { refreshAuthStatus, useAuthStatus } from '../lib/auth-status.js';
import { toast } from './ui/toast.js';

interface PublishProfileDialogProps {
  open: boolean;
  profileName: string | null;
  onOpenChange: (open: boolean) => void;
}

type PublishMode = 'upload' | 'github';

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export default function PublishProfileDialog({
  open,
  profileName,
  onOpenChange,
}: PublishProfileDialogProps) {
  const [mode, setMode] = useState<PublishMode>('upload');
  const [repoUrl, setRepoUrl] = useState('');
  const [slug, setSlug] = useState('');
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [refName, setRefName] = useState('main');
  const [profilePath, setProfilePath] = useState('profile.yaml');
  const [version, setVersion] = useState('1.0.0');
  const [changelog, setChangelog] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { status } = useAuthStatus();
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!open) {
      setRepoUrl('');
      setSummary('');
      setRefName('main');
      setProfilePath('profile.yaml');
      setVersion('1.0.0');
      setChangelog('');
      setBusy(false);
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      setError(null);
      setMode('upload');
      return;
    }
    if (profileName) {
      setSlug(slugify(profileName));
      setTitle(profileName);
    }
  }, [open, profileName]);

  async function startSignIn() {
    setBusy(true);
    try {
      const res = await fetch('/api/auth/start', { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { url } = (await res.json()) as { url: string };
      window.open(url, '_blank', 'noopener,noreferrer');
      if (pollRef.current) clearInterval(pollRef.current);
      const stop = Date.now() + 5 * 60 * 1000;
      pollRef.current = setInterval(async () => {
        const data = await refreshAuthStatus();
        if (data?.signedIn || Date.now() > stop) {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          if (data?.signedIn) toast.success('Signed in to brainctl');
        }
      }, 2000);
    } catch (err) {
      toast.error(`Sign-in failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (!slug.trim() || !title.trim()) {
      setError('Slug and title are required.');
      return;
    }
    if (mode === 'github' && !repoUrl.trim()) {
      setError('GitHub repo URL is required.');
      return;
    }
    if (mode === 'upload' && !profileName) {
      setError('No profile selected.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const endpoint =
        mode === 'github' ? '/api/profiles/register-github' : '/api/profiles/publish';
      const body =
        mode === 'github'
          ? {
              repoUrl: repoUrl.trim(),
              slug: slug.trim(),
              title: title.trim(),
              summary: summary.trim() || undefined,
              refName: refName.trim() || undefined,
              profilePath: profilePath.trim() || undefined,
            }
          : {
              profileName,
              slug: slug.trim(),
              title: title.trim(),
              summary: summary.trim() || undefined,
              version: version.trim() || undefined,
              changelog: changelog.trim() || undefined,
            };
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      toast.success(
        mode === 'github'
          ? `Registered "${slug.trim()}" with the brainctl registry`
          : `Published "${slug.trim()}" to the brainctl registry`
      );
      onOpenChange(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      toast.error(`Publish failed: ${message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-zinc-200/80 bg-white p-6 shadow-xl">
          <Dialog.Title className="flex items-center gap-2 text-lg font-semibold tracking-tight text-zinc-900">
            <UploadCloud size={18} className="text-zinc-600" /> Publish to registry
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-zinc-500">
            Upload your local profile package, or register a GitHub-hosted profile by URL.
          </Dialog.Description>

          <div className="mt-4 inline-flex h-8 items-center gap-0.5 rounded-lg bg-zinc-100 p-0.5">
            <button
              type="button"
              onClick={() => setMode('upload')}
              disabled={busy}
              className={`h-7 rounded-md px-3 text-[12px] font-medium transition-colors ${
                mode === 'upload'
                  ? 'bg-white text-zinc-900 shadow-sm'
                  : 'text-zinc-500 hover:text-zinc-700'
              }`}
            >
              Direct upload
            </button>
            <button
              type="button"
              onClick={() => setMode('github')}
              disabled={busy}
              className={`h-7 rounded-md px-3 text-[12px] font-medium transition-colors ${
                mode === 'github'
                  ? 'bg-white text-zinc-900 shadow-sm'
                  : 'text-zinc-500 hover:text-zinc-700'
              }`}
            >
              From GitHub
            </button>
          </div>

          <div className="mt-4 flex flex-col gap-3">
            {mode === 'github' && (
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-zinc-700">GitHub repo URL</span>
                <input
                  type="text"
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  disabled={busy}
                  placeholder="https://github.com/user/repo"
                  className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-400 focus:outline-none"
                  autoFocus
                />
              </label>
            )}

            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-zinc-700">Slug</span>
                <input
                  type="text"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  disabled={busy}
                  className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-400 focus:outline-none"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-zinc-700">Title</span>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  disabled={busy}
                  className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-400 focus:outline-none"
                />
              </label>
            </div>

            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-zinc-700">
                Summary <span className="font-normal text-zinc-400">(optional)</span>
              </span>
              <input
                type="text"
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                disabled={busy}
                className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-400 focus:outline-none"
              />
            </label>

            {mode === 'github' ? (
              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-zinc-700">Ref</span>
                  <input
                    type="text"
                    value={refName}
                    onChange={(e) => setRefName(e.target.value)}
                    disabled={busy}
                    className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-400 focus:outline-none"
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-zinc-700">Profile path</span>
                  <input
                    type="text"
                    value={profilePath}
                    onChange={(e) => setProfilePath(e.target.value)}
                    disabled={busy}
                    className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-400 focus:outline-none"
                  />
                </label>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-[1fr_2fr] gap-3">
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="font-medium text-zinc-700">Version</span>
                    <input
                      type="text"
                      value={version}
                      onChange={(e) => setVersion(e.target.value)}
                      disabled={busy}
                      placeholder="1.0.0"
                      className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-400 focus:outline-none"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="font-medium text-zinc-700">
                      Changelog <span className="font-normal text-zinc-400">(optional)</span>
                    </span>
                    <input
                      type="text"
                      value={changelog}
                      onChange={(e) => setChangelog(e.target.value)}
                      disabled={busy}
                      className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-400 focus:outline-none"
                    />
                  </label>
                </div>
              </>
            )}

            {error && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
                {error}
              </div>
            )}
          </div>

          {status && !status.signedIn && (
            <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <span>You need to sign in to publish.</span>
              <button
                type="button"
                onClick={() => void startSignIn()}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-2 py-1 text-[11px] font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
              >
                <LogIn size={12} /> Sign in
              </button>
            </div>
          )}

          <div className="mt-6 flex items-center justify-end gap-3">
            <Dialog.Close asChild>
              <button
                type="button"
                disabled={busy}
                className="inline-flex min-h-[36px] items-center justify-center rounded-lg border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-700 shadow-sm transition-all hover:bg-zinc-50 hover:text-zinc-900"
              >
                Cancel
              </button>
            </Dialog.Close>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={busy || !status?.signedIn}
              title={status?.signedIn ? '' : 'Sign in to publish'}
              className="inline-flex min-h-[36px] items-center justify-center gap-2 rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white shadow-sm transition-all hover:bg-zinc-800 disabled:opacity-60"
            >
              {busy && <LoaderCircle size={14} className="animate-spin" />}
              {busy ? 'Publishing…' : mode === 'github' ? 'Register' : 'Publish'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
