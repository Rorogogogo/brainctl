import { FileText, LoaderCircle } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

import { AgentLogo } from './agent-brand';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select.js';
import { toast } from './ui/toast.js';
import { snapshotProfile } from '../lib/profile-snapshot';

type Agent = 'claude' | 'codex' | 'antigravity';
type Source = 'blank' | Agent;

const PROFILE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function slugifyProfileName(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9.-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
}

interface CreateProfileDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (profileName: string) => void;
}

const SOURCE_OPTIONS: Array<{ value: Source; label: string; icon: ReactNode }> = [
  {
    value: 'claude',
    label: 'From Claude',
    icon: <AgentLogo agent="claude" className="size-full object-contain" />,
  },
  {
    value: 'codex',
    label: 'From Codex',
    icon: <AgentLogo agent="codex" className="size-full object-contain" />,
  },
  {
    value: 'antigravity',
    label: 'From Antigravity',
    icon: <AgentLogo agent="antigravity" className="size-full object-contain" />,
  },
  {
    value: 'blank',
    label: 'Blank',
    icon: <FileText size={12} className="text-muted-foreground" />,
  },
];

export default function CreateProfileDialog({
  open,
  onOpenChange,
  onCreated,
}: CreateProfileDialogProps) {
  const [name, setName] = useState('');
  const [source, setSource] = useState<Source>('claude');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progressMessage, setProgressMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setName('');
      setSource('claude');
      setBusy(false);
      setError(null);
      setProgressMessage(null);
    }
  }, [open]);

  async function submit() {
    const trimmed = slugifyProfileName(name);
    if (source === 'blank' && !trimmed) {
      setError('Profile name is required for an empty profile.');
      return;
    }
    if (trimmed && !PROFILE_NAME_PATTERN.test(trimmed)) {
      setError('Use letters, numbers, ".", "_", or "-". Must start with a letter or number.');
      return;
    }
    if (trimmed && trimmed !== name.trim()) setName(trimmed);
    setBusy(true);
    setError(null);
    setProgressMessage(source === 'blank' ? 'Creating empty profile…' : `Reading ${source} config…`);
    try {
      let resultName = trimmed;
      if (source === 'blank') {
        const r = await fetch('/api/profiles', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: trimmed }),
        });
        if (!r.ok) {
          const data = (await r.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error ?? `HTTP ${r.status}`);
        }
      } else {
        const data = await snapshotProfile({
          agent: source,
          ...(trimmed ? { as: trimmed } : {}),
          onProgress: setProgressMessage,
        });
        resultName = data.profileName;
      }
      onCreated(resultName);
      onOpenChange(false);
      toast.success(
        source === 'blank'
          ? `Created empty profile "${resultName}"`
          : `Snapshotted ${source} into profile "${resultName}"`
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      toast.error(`Failed to create profile: ${message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent hideClose>
        <DialogHeader>
          <DialogTitle>Create profile</DialogTitle>
          <DialogDescription>
            Start blank, or capture a live agent's current MCPs, plugins, and skills.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label>Source</Label>
            <Select value={source} onValueChange={(v) => setSource(v as Source)} disabled={busy}>
              <SelectTrigger>
                <SelectValue>
                  <span className="inline-flex items-center gap-2">
                    <span className="grid size-3.5 place-items-center overflow-hidden">
                      {SOURCE_OPTIONS.find((o) => o.value === source)?.icon}
                    </span>
                    <span>{SOURCE_OPTIONS.find((o) => o.value === source)?.label ?? ''}</span>
                  </span>
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {SOURCE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    <span className="inline-flex items-center gap-2">
                      <span className="grid size-3.5 place-items-center overflow-hidden">{opt.icon}</span>
                      <span>{opt.label}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>
              Name{' '}
              {source !== 'blank' && (
                <span className="font-normal text-muted-foreground">(optional — auto-generated if empty)</span>
              )}
            </Label>
            <Input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => {
                const s = slugifyProfileName(name);
                if (s && s !== name) setName(s);
              }}
              disabled={busy}
              placeholder={source === 'blank' ? 'my-profile' : `backup-${source}-…`}
              autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
            />
            <p className="text-xs text-muted-foreground">
              Letters, numbers, ".", "_", or "-". Spaces are auto-converted to dashes.
            </p>
          </div>

          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}

          {busy && progressMessage && (
            <div className="flex items-center gap-2 rounded-md border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
              <LoaderCircle size={14} className="shrink-0 animate-spin" />
              <span className="min-w-0 truncate">{progressMessage}</span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy}>
            {busy ? 'Creating…' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
