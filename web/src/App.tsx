import { useState } from 'react';
import { Check, Download, Loader2 } from 'lucide-react';

import { AgentLogo } from './components/agent-brand';
import CreateProfileButton from './components/CreateProfileButton';
import { toast } from './components/ui/toast.js';
import ApplyProfilePanel from './profiles/ApplyProfilePanel';
import ProfilesDrawer from './profiles/ProfilesDrawer';
import ProfilesView from './profiles/ProfilesView';

const AGENTS = ['claude', 'codex', 'gemini'] as const;
type Agent = typeof AGENTS[number];

const AGENT_LABELS: Record<Agent, string> = {
  claude: 'Claude',
  codex: 'Codex',
  gemini: 'Gemini',
};

interface SnapshotState {
  status: 'idle' | 'pending' | 'success' | 'error';
  message?: string;
}

function SnapshotButtons() {
  const [state, setState] = useState<Record<Agent, SnapshotState>>({
    claude: { status: 'idle' },
    codex: { status: 'idle' },
    gemini: { status: 'idle' },
  });

  async function snapshot(agent: Agent) {
    setState((prev) => ({ ...prev, [agent]: { status: 'pending' } }));
    try {
      const r = await fetch('/api/profiles/snapshot', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ agent }),
      });
      if (!r.ok) {
        const data = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `HTTP ${r.status}`);
      }
      const data = (await r.json()) as { profileName: string };
      setState((prev) => ({
        ...prev,
        [agent]: { status: 'success', message: data.profileName },
      }));
      toast.success(`Created profile "${data.profileName}" from ${AGENT_LABELS[agent]}`);
      window.dispatchEvent(new CustomEvent('brainctl:profiles-changed'));
      setTimeout(() => {
        setState((prev) => ({ ...prev, [agent]: { status: 'idle' } }));
      }, 3000);
    } catch (err) {
      setState((prev) => ({
        ...prev,
        [agent]: {
          status: 'error',
          message: err instanceof Error ? err.message : 'Snapshot failed',
        },
      }));
      toast.error(`Failed to create snapshot: ${err instanceof Error ? err.message : 'Snapshot failed'}`);
    }
  }

  return (
    <div className="flex items-center gap-1 rounded-xl border border-zinc-200 bg-white px-2 py-1 shadow-sm">
      <span className="px-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
        Snapshot
      </span>
      {AGENTS.map((agent) => {
        const s = state[agent];
        return (
          <button
            key={agent}
            type="button"
            onClick={() => void snapshot(agent)}
            disabled={s.status === 'pending'}
            title={
              s.status === 'success'
                ? `Saved as ${s.message}`
                : s.status === 'error'
                  ? s.message ?? 'Snapshot failed'
                  : `Capture current ${agent} state into a new profile`
            }
            className={`grid size-6 place-items-center rounded transition ${
              s.status === 'success'
                ? 'bg-emerald-100'
                : s.status === 'error'
                  ? 'bg-rose-100'
                  : s.status === 'pending'
                    ? 'bg-zinc-100'
                    : 'hover:bg-zinc-100'
            }`}
          >
            {s.status === 'pending' ? (
              <Loader2 size={11} className="animate-spin text-zinc-500" />
            ) : s.status === 'success' ? (
              <Check size={11} className="text-emerald-700" />
            ) : (
              <span className="grid size-3.5 place-items-center overflow-hidden">
                <AgentLogo agent={agent} className="size-full object-contain" />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export default function App() {
  const [applyProfileName, setApplyProfileName] = useState<string | null>(null);

  return (
    <main className="h-screen overflow-hidden bg-[#fcfcfc] p-4 text-zinc-900">
      <div className="mx-auto grid h-full w-full grid-rows-[auto_minmax(0,1fr)] gap-4">
        <header className="flex min-h-0 shrink-0 flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <div className="grid size-7 place-items-center rounded-lg bg-zinc-900 text-white shadow-sm">
              <img src="/favicon-light.svg" alt="Brainctl Logo" className="size-4" />
            </div>
            <div>
              <h1 className="text-sm font-semibold leading-none tracking-tight">
                Brainctl <span className="font-normal text-zinc-400">v{__APP_VERSION__}</span>
              </h1>
              <p className="text-[9px] font-medium leading-tight text-zinc-500">Transfer Board</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <SnapshotButtons />
            <CreateProfileButton />
            <a
              href="https://www.brainctl.net"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-9 items-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-700 shadow-sm transition-colors hover:bg-zinc-50 hover:text-zinc-900"
            >
              <Download size={16} />
              <span>Install</span>
            </a>
          </div>
        </header>

        <section className="-ml-4 flex min-h-0 w-full gap-4 overflow-hidden pt-4">
          <ProfilesDrawer onApplyProfile={setApplyProfileName} />
          <div className="scrollbar-none min-w-0 flex-1 overflow-y-auto pr-1">
            {applyProfileName ? (
              <ApplyProfilePanel
                initialProfile={applyProfileName}
                onCancel={() => setApplyProfileName(null)}
                onApplied={() => {
                  window.dispatchEvent(new CustomEvent('brainctl:profiles-changed'));
                }}
              />
            ) : (
              <ProfilesView />
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
