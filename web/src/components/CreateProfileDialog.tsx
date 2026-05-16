import * as Dialog from '@radix-ui/react-dialog';
import * as Select from '@radix-ui/react-select';
import { Check as CheckIcon, ChevronDown, FileText, LoaderCircle } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

import { AgentLogo } from './agent-brand';
import { toast } from './ui/toast.js';
import { snapshotProfile } from '../lib/profile-snapshot';

type Agent = 'claude' | 'codex' | 'gemini';
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
    value: 'gemini',
    label: 'From Gemini',
    icon: <AgentLogo agent="gemini" className="size-full object-contain" />,
  },
  {
    value: 'blank',
    label: 'Blank',
    icon: <FileText size={12} className="text-zinc-500" />,
  },
];

function SourceItemContent({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="grid size-3.5 place-items-center overflow-hidden">{icon}</span>
      <span>{label}</span>
    </span>
  );
}

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
    if (trimmed && trimmed !== name.trim()) {
      setName(trimmed);
    }
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
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-zinc-200/80 bg-white p-6 shadow-xl">
          <Dialog.Title className="text-lg font-semibold tracking-tight text-zinc-900">
            Create profile
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-zinc-500">
            Start blank, or capture a live agent's current MCPs, plugins, and skills.
          </Dialog.Description>

          <div className="mt-4 flex flex-col gap-3">
            <div className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-zinc-700">Source</span>
              <Select.Root
                value={source}
                onValueChange={(v) => setSource(v as Source)}
                disabled={busy}
              >
                <Select.Trigger
                  className="inline-flex items-center justify-between rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-400 focus:outline-none disabled:opacity-60"
                  aria-label="Source"
                >
                  <Select.Value>
                    <SourceItemContent
                      icon={SOURCE_OPTIONS.find((o) => o.value === source)?.icon}
                      label={SOURCE_OPTIONS.find((o) => o.value === source)?.label ?? ''}
                    />
                  </Select.Value>
                  <Select.Icon>
                    <ChevronDown size={14} className="text-zinc-500" />
                  </Select.Icon>
                </Select.Trigger>
                <Select.Portal>
                  <Select.Content
                    position="popper"
                    sideOffset={4}
                    className="z-[60] overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-lg"
                  >
                    <Select.Viewport className="p-1">
                      {SOURCE_OPTIONS.map((opt) => (
                        <Select.Item
                          key={opt.value}
                          value={opt.value}
                          className="relative flex cursor-pointer select-none items-center gap-2 rounded-md px-2 py-1.5 pr-8 text-sm text-zinc-800 outline-none data-[highlighted]:bg-zinc-100"
                        >
                          <Select.ItemText>
                            <SourceItemContent icon={opt.icon} label={opt.label} />
                          </Select.ItemText>
                          <Select.ItemIndicator className="absolute right-2 inline-flex items-center">
                            <CheckIcon size={12} className="text-zinc-700" />
                          </Select.ItemIndicator>
                        </Select.Item>
                      ))}
                    </Select.Viewport>
                  </Select.Content>
                </Select.Portal>
              </Select.Root>
            </div>

            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-zinc-700">
                Name
                {source !== 'blank' && (
                  <span className="ml-1 font-normal text-zinc-400">(optional — auto-generated if empty)</span>
                )}
              </span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => {
                  const s = slugifyProfileName(name);
                  if (s && s !== name) setName(s);
                }}
                disabled={busy}
                placeholder={source === 'blank' ? 'my-profile' : `backup-${source}-…`}
                pattern="^[A-Za-z0-9][A-Za-z0-9._-]*$"
                title='Letters, numbers, ".", "_", or "-". Must start with a letter or number.'
                className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-400 focus:outline-none"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void submit();
                }}
              />
              <span className="text-xs text-zinc-500">
                Letters, numbers, ".", "_", or "-". Spaces are auto-converted to dashes.
              </span>
            </label>

            {error && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
                {error}
              </div>
            )}

            {busy && progressMessage && (
              <div className="flex min-h-8 items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
                <LoaderCircle size={14} className="shrink-0 animate-spin text-zinc-500" />
                <span className="min-w-0 truncate">{progressMessage}</span>
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
                Cancel
              </button>
            </Dialog.Close>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={busy}
              className="inline-flex min-h-[36px] items-center justify-center rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white shadow-sm transition-all hover:bg-zinc-800 disabled:opacity-60"
            >
              {busy ? 'Creating…' : 'Create'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
