import { Upload, LoaderCircle } from 'lucide-react';
import { useEffect, useRef, useState, type DragEvent } from 'react';

import { cn } from '../lib/utils.js';
import { Button } from './ui/button.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog.js';
import { Input } from './ui/input.js';
import { Label } from './ui/label.js';
import { toast } from './ui/toast.js';

interface ImportProfileDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: (profileName: string) => void;
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
    }
  }, [open]);

  function parseMissingCreds(message: string): string[] {
    const m = message.match(/Missing required credentials:\s*([^.]+)\./i);
    if (!m) return [];
    return m[1].split(',').map((s) => s.trim()).filter((s) => s.length > 0);
  }

  function buildCredsObject(): Record<string, string> | undefined {
    const filled = Object.fromEntries(Object.entries(creds).filter(([, v]) => v.trim().length > 0));
    return Object.keys(filled).length > 0 ? filled : undefined;
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) { setFile(dropped); setError(null); }
  }

  async function uploadFile() {
    if (!file) { setError('Pick a .tar.gz file first.'); return; }
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const bytes = await file.arrayBuffer();
      const url = `/api/profiles/import-upload?force=${force ? 'true' : 'false'}`;
      const credsObj = buildCredsObject();
      const headers: Record<string, string> = { 'content-type': 'application/octet-stream' };
      if (credsObj) headers['x-brainctl-credentials'] = btoa(JSON.stringify(credsObj));
      const r = await fetch(url, { method: 'POST', headers, body: bytes });
      if (!r.ok) {
        const data = (await r.json().catch(() => ({}))) as { error?: string };
        const message = data.error ?? `HTTP ${r.status}`;
        const keys = parseMissingCreds(message);
        if (keys.length > 0) {
          setMissingCreds(keys);
          setCreds((prev) => { const next = { ...prev }; for (const k of keys) if (!(k in next)) next[k] = ''; return next; });
        }
        throw new Error(message);
      }
      const data = (await r.json()) as ImportResult;
      const needed = data.requiredCredentials ?? [];
      if (needed.length > 0) {
        setMissingCreds(needed.map((c) => c.key));
        setCreds((prev) => { const next = { ...prev }; for (const c of needed) if (!(c.key in next)) next[c.key] = ''; return next; });
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
    if (!trimmed) { setError('Enter a registry slug.'); return; }
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
          setCreds((prev) => { const next = { ...prev }; for (const k of keys) if (!(k in next)) next[k] = ''; return next; });
        }
        throw new Error(message);
      }
      const data = (await r.json()) as ImportResult;
      const versionLabel = data.version ? ` (v${data.version})` : '';
      const needed = data.requiredCredentials ?? [];
      if (needed.length > 0) {
        setMissingCreds(needed.map((c) => c.key));
        setCreds((prev) => { const next = { ...prev }; for (const c of needed) if (!(c.key in next)) next[c.key] = ''; return next; });
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent hideClose>
        <DialogHeader>
          <DialogTitle>Import profile</DialogTitle>
          <DialogDescription>
            Upload a portable profile archive, or install one from the registry by slug.
          </DialogDescription>
        </DialogHeader>

        <div className="inline-flex rounded-lg border border-border bg-muted p-0.5 text-xs font-medium">
          <button
            type="button"
            onClick={() => { setMode('file'); setError(null); setSuccess(null); }}
            disabled={busy}
            className={cn('rounded-md px-3 py-1.5 transition-all', mode === 'file' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}
          >
            Upload file
          </button>
          <button
            type="button"
            onClick={() => { setMode('slug'); setError(null); setSuccess(null); }}
            disabled={busy}
            className={cn('rounded-md px-3 py-1.5 transition-all', mode === 'slug' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}
          >
            Install by slug
          </button>
        </div>

        <div className="flex flex-col gap-3">
          {mode === 'file' ? (
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors',
                dragOver ? 'border-primary bg-muted/50' : 'border-border bg-background hover:bg-muted/30'
              )}
            >
              <Upload size={20} className="text-muted-foreground" />
              {file ? (
                <div className="text-sm font-medium text-foreground">
                  {file.name}
                  <div className="text-xs font-normal text-muted-foreground">{(file.size / 1024).toFixed(1)} KB</div>
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">
                  Drop a <code className="rounded bg-muted px-1 text-xs">.tar.gz</code> file or click to browse
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept=".tar.gz,.tgz,application/gzip,application/octet-stream"
                className="hidden"
                onChange={(e) => { const picked = e.target.files?.[0]; if (picked) { setFile(picked); setError(null); } }}
              />
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <Label>Registry slug</Label>
              <Input
                type="text"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                disabled={busy}
                placeholder="user/profile-name"
                autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') void installSlug(); }}
              />
              <p className="text-xs text-muted-foreground">
                The slug of a published profile on the marketplace.
              </p>
            </div>
          )}

          <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={force}
              onChange={(e) => setForce(e.target.checked)}
              disabled={busy}
              className="size-3.5 rounded border-border"
            />
            Force overwrite if a profile with the same name exists
          </label>

          {missingCreds.length > 0 && (
            <div className="flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3">
              <div className="text-xs font-medium text-amber-900">Credentials required</div>
              <div className="text-[11px] text-amber-800">
                This profile bundles MCPs that need these values. Fill them in and click {mode === 'file' ? 'Import' : 'Install'} again.
              </div>
              {missingCreds.map((key) => (
                <label key={key} className="flex flex-col gap-1 text-xs text-amber-900">
                  <code className="font-mono">{key}</code>
                  <Input
                    type="password"
                    value={creds[key] ?? ''}
                    onChange={(e) => setCreds((prev) => ({ ...prev, [key]: e.target.value }))}
                    disabled={busy}
                    className="border-amber-200 focus-visible:ring-amber-400"
                  />
                </label>
              ))}
            </div>
          )}

          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}

          {success && !busy && (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
              {success}
            </div>
          )}

          {busy && (
            <div className="flex items-center gap-2 rounded-md border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
              <LoaderCircle size={14} className="shrink-0 animate-spin" />
              <span className="min-w-0 truncate">
                {mode === 'file' ? 'Uploading and importing…' : 'Installing from registry…'}
              </span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button
            onClick={() => (mode === 'file' ? void uploadFile() : void installSlug())}
            disabled={busy || (mode === 'file' ? !file : !slug.trim())}
          >
            {busy ? (mode === 'file' ? 'Importing…' : 'Installing…') : mode === 'file' ? 'Import' : 'Install'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
