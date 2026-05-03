import * as Dialog from '@radix-ui/react-dialog';
import * as Select from '@radix-ui/react-select';
import { Check as CheckIcon, ChevronDown, FileText } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

import { AgentLogo } from './agent-brand';

type Agent = 'claude' | 'codex' | 'gemini';
type Source = 'blank' | Agent;

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

  useEffect(() => {
    if (!open) {
      setName('');
      setSource('claude');
      setBusy(false);
      setError(null);
    }
  }, [open]);

  async function submit() {
    const trimmed = name.trim();
    if (source === 'blank' && !trimmed) {
      setError('Profile name is required for an empty profile.');
      return;
    }
    setBusy(true);
    setError(null);
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
        const r = await fetch('/api/profiles/snapshot', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            agent: source,
            ...(trimmed ? { as: trimmed } : {}),
          }),
        });
        if (!r.ok) {
          const data = (await r.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error ?? `HTTP ${r.status}`);
        }
        const data = (await r.json()) as { profileName: string };
        resultName = data.profileName;
      }
      onCreated(resultName);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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
                disabled={busy}
                placeholder={source === 'blank' ? 'my-profile' : `backup-${source}-…`}
                className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-400 focus:outline-none"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void submit();
                }}
              />
            </label>

            {error && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
                {error}
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
