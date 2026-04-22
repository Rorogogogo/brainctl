import { type ReactNode } from 'react';
import { Boxes, Download } from 'lucide-react';

import { AgentLogo } from './agent-brand';
import ProfilesView from './ProfilesView';

const AGENTS = ['claude', 'codex', 'gemini'] as const;

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
            <ActionButton
              icon={<Boxes size={12} />}
              label="Pack"
              tooltip="Coming soon — still grinding on portable packs"
            />
            <ActionButton
              icon={<Download size={16} />}
              label="Install"
              tooltip="Coming soon — portable install flow under construction"
            />
          </div>
        </header>

        <section className="w-full pt-4">
          <ProfilesView />
        </section>
      </div>
    </main>
  );
}
