import { useState, type ReactNode } from 'react';
import { Check, Download, Loader2 } from 'lucide-react';

import { AgentLogo } from './components/agent-brand';
import ProfilesDrawer from './profiles/ProfilesDrawer';
import ProfilesView from './profiles/ProfilesView';

const AGENTS = ['claude', 'codex', 'gemini'] as const;
type Agent = typeof AGENTS[number];

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

function ActionButton({
  icon,
  label,
  tooltip,
}: {
  icon: ReactNode;
  label: string;
  tooltip: string;
}) {
  return (
    <div className="relative group">
      <button
        className="inline-flex h-9 cursor-not-allowed items-center gap-2 rounded-xl border border-zinc-200 bg-white/60 px-4 text-sm font-medium text-zinc-400"
        type="button"
        disabled
        aria-disabled="true"
      >
        {icon}
        <span>{label}</span>
      </button>
      <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 -translate-x-1/2 whitespace-nowrap rounded-md bg-zinc-900 px-2.5 py-1.5 text-[11px] font-medium text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100">
        {tooltip}
      </span>
    </div>
  );
}

export default function App() {
  return (
    <main className="min-h-screen bg-[#fcfcfc] p-4 text-zinc-900 lg:p-6">
      <div className="mx-auto grid w-full gap-4">
        <header className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <div className="grid size-7 place-items-center rounded-lg bg-zinc-900 text-white shadow-sm">
              <img src="/brainctl-mark.svg" alt="Brainctl Logo" className="size-4" />
            </div>
            <div>
              <h1 className="text-sm font-semibold leading-none tracking-tight">Brainctl</h1>
              <p className="text-[9px] font-medium leading-tight text-zinc-500">Transfer Board</p>
            </div>
          </div>

          <div className="hidden items-center gap-1.5 lg:flex">
            {AGENTS.map((agent) => (
              <span
                key={agent}
                className="inline-flex h-8 flex-none items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3 text-[10px] font-medium text-zinc-600 shadow-sm"
              >
                <span className="grid size-3.5 place-items-center overflow-hidden text-zinc-900">
                  <AgentLogo agent={agent} className="size-full object-contain" />
                </span>
                {agent.charAt(0).toUpperCase() + agent.slice(1)}
              </span>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <SnapshotButtons />
            <ActionButton
              icon={<Download size={16} />}
              label="Install"
              tooltip="Coming soon — portable install flow under construction"
            />
          </div>
        </header>

        <section className="flex w-full gap-4 pt-4">
          <ProfilesDrawer />
          <div className="flex-1">
            <ProfilesView />
          </div>
        </section>
      </div>
    </main>
  );
}
