import * as Dialog from '@radix-ui/react-dialog';
import { LoaderCircle, Upload } from 'lucide-react';
import { useEffect, useRef, useState, type DragEvent } from 'react';

import { toast } from './ui/toast.js';

interface ImportProfileDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: (profileName: string) => void;
  /** When provided, the dialog opens in "Install by slug" mode pre-filled with this slug. */
  initialSlug?: string;
}

interface ImportResult {
  profileName: string;
  version?: string;
  requiredCredentials?: Array<{ key: string; description?: string }>;
}

export default function ImportProfileDialog({
  open,
  onOpenChange,
  onImported,
  initialSlug,
}: ImportProfileDialogProps) {
  const [mode, setMode] = useState<'file' | 'slug'>('file');
  const [file, setFile] = useState<File | null>(null);
  const [slug, setSlug] = useState('');
  const [force, setForce] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [missingCreds, setMissingCreds] = useState<string[]>([]);
  const [creds, setCreds] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setMode('file');
      setFile(null);
      setSlug('');
      setForce(false);
      setBusy(false);
      setError(null);
      setSuccess(null);
      setDragOver(false);
      setMissingCreds([]);
      setCreds({});
    } else if (initialSlug) {
      setMode('slug');
      setSlug(initialSlug);
    }
  }, [open, initialSlug]);

  function parseMissingCreds(message: string): string[] {
    const m = message.match(/Missing required credentials:\s*([^.]+)\./i);
    if (!m) return [];
    return m[1].split(',').map((s) => s.trim()).filter((s) => s.length > 0);
  }

  function buildCredsObject(): Record<string, string> | undefined {
    const filled = Object.fromEntries(
      Object.entries(creds).filter(([, v]) => v.trim().length > 0),
    );
    return Object.keys(filled).length > 0 ? filled : undefined;
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) {
      setFile(dropped);
      setError(null);
    }
  }

  async function uploadFile() {
    if (!file) {
      setError('Pick a .tar.gz file first.');
      return;
    }
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const bytes = await file.arrayBuffer();
      const url = `/api/profiles/import-upload?force=${force ? 'true' : 'false'}`;
      const credsObj = buildCredsObject();
      const headers: Record<string, string> = { 'content-type': 'application/octet-stream' };
      if (credsObj) {
        headers['x-brainctl-credentials'] = btoa(JSON.stringify(credsObj));
      }
      const r = await fetch(url, { method: 'POST', headers, body: bytes });
      if (!r.ok) {
        const data = (await r.json().catch(() => ({}))) as { error?: string };
        const message = data.error ?? `HTTP ${r.status}`;
        const keys = parseMissingCreds(message);
        if (keys.length > 0) {
          setMissingCreds(keys);
          setCreds((prev) => {
            const next = { ...prev };
            for (const k of keys) if (!(k in next)) next[k] = '';
            return next;
          });
        }
        throw new Error(message);
      }
      const data = (await r.json()) as ImportResult;
      const needed = data.requiredCredentials ?? [];
      if (needed.length > 0) {
        setMissingCreds(needed.map((c) => c.key));
        setCreds((prev) => {
          const next = { ...prev };
          for (const c of needed) if (!(c.key in next)) next[c.key] = '';
          return next;
        });
        setSuccess(`Imported "${data.profileName}" — but credentials are still required before it can be applied.`);
        toast.success(`Imported "${data.profileName}" (credentials needed)`);
      } else {
        setSuccess(`Imported profile "${data.profileName}".`);
        setMissingCreds([]);
        toast.success(`Imported profile "${data.profileName}"`);
      }
      onImported(data.profileName);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      toast.error(`Import failed: ${message}`);
    } finally {
      setBusy(false);
    }
  }

  async function installSlug() {
    const trimmed = slug.trim();
    if (!trimmed) {
      setError('Enter a registry slug.');
      return;
    }
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const credsObj = buildCredsObject();
      const r = await fetch('/api/profiles/install-from-registry', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug: trimmed, force, credentials: credsObj }),
      });
      if (!r.ok) {
        const data = (await r.json().catch(() => ({}))) as { error?: string };
        const message = data.error ?? `HTTP ${r.status}`;
        const keys = parseMissingCreds(message);
        if (keys.length > 0) {
          setMissingCreds(keys);
          setCreds((prev) => {
            const next = { ...prev };
            for (const k of keys) if (!(k in next)) next[k] = '';
            return next;
          });
        }
        throw new Error(message);
      }
      const data = (await r.json()) as ImportResult;
      const versionLabel = data.version ? ` (v${data.version})` : '';
      const needed = data.requiredCredentials ?? [];
      if (needed.length > 0) {
        setMissingCreds(needed.map((c) => c.key));
        setCreds((prev) => {
          const next = { ...prev };
          for (const c of needed) if (!(c.key in next)) next[c.key] = '';
          return next;
        });
        setSuccess(`Installed "${data.profileName}"${versionLabel} — but credentials are still required before it can be applied.`);
        toast.success(`Installed "${data.profileName}"${versionLabel} (credentials needed)`);
      } else {
        setSuccess(`Installed "${data.profileName}"${versionLabel}.`);
        setMissingCreds([]);
        toast.success(`Installed profile "${data.profileName}"${versionLabel}`);
      }
      onImported(data.profileName);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      toast.error(`Install failed: ${message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-zinc-200/80 bg-white p-6 shadow-xl">
          <Dialog.Title className="text-lg font-semibold tracking-tight text-zinc-900">
            Import profile
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-zinc-500">
            Upload a portable profile archive, or install one from the registry by slug.
          </Dialog.Description>

          <div className="mt-4 inline-flex rounded-lg border border-zinc-200 bg-zinc-50 p-0.5 text-xs font-medium">
            <button
              type="button"
              onClick={() => {
                setMode('file');
                setError(null);
                setSuccess(null);
              }}
              disabled={busy}
              className={`rounded-md px-3 py-1.5 transition-all ${mode === 'file' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-600 hover:text-zinc-900'}`}
            >
              Upload file
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('slug');
                setError(null);
                setSuccess(null);
              }}
              disabled={busy}
              className={`rounded-md px-3 py-1.5 transition-all ${mode === 'slug' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-600 hover:text-zinc-900'}`}
            >
              Install by slug
            </button>
          </div>

          <div className="mt-4 flex flex-col gap-3">
            {mode === 'file' ? (
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors ${dragOver ? 'border-zinc-900 bg-zinc-50' : 'border-zinc-200 bg-white hover:bg-zinc-50'}`}
              >
                <Upload size={20} className="text-zinc-400" />
                {file ? (
                  <div className="text-sm font-medium text-zinc-900">
                    {file.name}
                    <div className="text-xs font-normal text-zinc-500">
                      {(file.size / 1024).toFixed(1)} KB
                    </div>
                  </div>
                ) : (
                  <div className="text-sm text-zinc-600">
                    Drop a <code className="rounded bg-zinc-100 px-1 text-xs">.tar.gz</code> file or click to browse
                  </div>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".tar.gz,.tgz,application/gzip,application/octet-stream"
                  className="hidden"
                  onChange={(e) => {
                    const picked = e.target.files?.[0];
                    if (picked) {
                      setFile(picked);
                      setError(null);
                    }
                  }}
                />
              </div>
            ) : (
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-zinc-700">Registry slug</span>
                <input
                  type="text"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  disabled={busy}
                  placeholder="user/profile-name"
                  className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-400 focus:outline-none"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void installSlug();
                  }}
                />
                <span className="text-xs text-zinc-500">
                  The slug of a published profile on the marketplace.
                </span>
              </label>
            )}

            <label className="inline-flex items-center gap-2 text-xs text-zinc-700">
              <input
                type="checkbox"
                checked={force}
                onChange={(e) => setForce(e.target.checked)}
                disabled={busy}
                className="size-3.5 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-400"
              />
              Force overwrite if a profile with the same name exists
            </label>

            {missingCreds.length > 0 && (
              <div className="flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3">
                <div className="text-xs font-medium text-amber-900">
                  Credentials required
                </div>
                <div className="text-[11px] text-amber-800">
                  This profile bundles MCPs that need these values. Fill them in and click {mode === 'file' ? 'Import' : 'Install'} again.
                </div>
                {missingCreds.map((key) => (
                  <label key={key} className="flex flex-col gap-1 text-xs text-amber-900">
                    <code className="font-mono">{key}</code>
                    <input
                      type="password"
                      value={creds[key] ?? ''}
                      onChange={(e) => setCreds((prev) => ({ ...prev, [key]: e.target.value }))}
                      disabled={busy}
                      className="rounded-md border border-amber-200 bg-white px-2 py-1.5 text-xs text-zinc-900 focus:border-amber-400 focus:outline-none"
                    />
                  </label>
                ))}
              </div>
            )}

            {error && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
                {error}
              </div>
            )}

            {success && !busy && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                {success}
              </div>
            )}

            {busy && (
              <div className="flex min-h-8 items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
                <LoaderCircle size={14} className="shrink-0 animate-spin text-zinc-500" />
                <span className="min-w-0 truncate">
                  {mode === 'file' ? 'Uploading and importing…' : 'Installing from registry…'}
                </span>
              </div>
            )}
          </div>

          <div className="mt-6 flex items-center justify-end gap-3">
            <Dialog.Close asChild>
              <button
                type="button"
                disabled={busy}
                className="inline-flex min-h-[36px] items-center justify-center rounded-lg border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-700 shadow-sm transition-all hover:bg-zinc-50 hover:text-zinc-900"
              >
                Close
              </button>
            </Dialog.Close>
            <button
              type="button"
              onClick={() => (mode === 'file' ? void uploadFile() : void installSlug())}
              disabled={busy || (mode === 'file' ? !file : !slug.trim())}
              className="inline-flex min-h-[36px] items-center justify-center rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white shadow-sm transition-all hover:bg-zinc-800 disabled:opacity-60"
            >
              {busy ? (mode === 'file' ? 'Importing…' : 'Installing…') : mode === 'file' ? 'Import' : 'Install'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
