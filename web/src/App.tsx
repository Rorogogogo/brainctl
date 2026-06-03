import { useState } from 'react';
import { BookOpen, Check, Loader2, Store } from 'lucide-react';

import { AgentLogo } from './components/agent-brand';
import ApiModeBadge from './components/ApiModeBadge';
import CreateProfileButton from './components/CreateProfileButton';
import ImportProfileButton from './components/ImportProfileButton';
import SignInButton from './components/SignInButton';
import { toast } from './components/ui/toast.js';
import { useAuthStatus } from './lib/auth-status.js';
import ApplyProfilePanel from './profiles/ApplyProfilePanel';
import EditProfilePanel from './profiles/EditProfilePanel';
import PublishProfilePanel from './profiles/PublishProfilePanel';
import ViewProfilePanel from './profiles/ViewProfilePanel';
import ProfilesDrawer from './profiles/ProfilesDrawer';
import ProfilesView from './profiles/ProfilesView';

const DEFAULT_MARKETPLACE_URL = 'https://www.brainctl.net';

function MarketplaceLink() {
  const { status } = useAuthStatus();
  const href = status?.apiFrontendUrl ?? DEFAULT_MARKETPLACE_URL;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={href}
      className="inline-flex h-9 items-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-700 shadow-sm transition-colors hover:bg-zinc-50 hover:text-zinc-900"
    >
      <Store size={16} />
      <span>Marketplace</span>
    </a>
  );
}

function DocsLink() {
  const { status } = useAuthStatus();
  const baseUrl = status?.apiFrontendUrl ?? DEFAULT_MARKETPLACE_URL;
  const href = `${baseUrl.replace(/\/$/, '')}/docs`;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={href}
      className="inline-flex h-9 items-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-700 shadow-sm transition-colors hover:bg-zinc-50 hover:text-zinc-900"
    >
      <BookOpen size={16} />
      <span>Docs</span>
    </a>
  );
}

const AGENTS = ['claude', 'codex', 'antigravity'] as const;
type Agent = typeof AGENTS[number];

const AGENT_LABELS: Record<Agent, string> = {
  claude: 'Claude',
  codex: 'Codex',
  antigravity: 'Antigravity',
};

interface SnapshotState {
  status: 'idle' | 'pending' | 'success' | 'error';
  message?: string;
}

function SnapshotButtons() {
  const [state, setState] = useState<Record<Agent, SnapshotState>>({
    claude: { status: 'idle' },
    codex: { status: 'idle' },
    antigravity: { status: 'idle' },
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
  const [publishProfileName, setPublishProfileName] = useState<string | null>(null);
  const [viewProfileName, setViewProfileName] = useState<string | null>(null);
  const [editProfileName, setEditProfileName] = useState<string | null>(null);

  return (
    <main className="h-screen overflow-hidden bg-[#fcfcfc] p-4 text-zinc-900">
      <div className="mx-auto grid h-full w-full grid-rows-[auto_minmax(0,1fr)] gap-4">
        <header className="flex min-h-0 shrink-0 flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <img src="/favicon.svg" alt="Brainctl Logo" className="size-8" />
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-semibold leading-none tracking-tight">
                Brainctl <span className="font-normal text-zinc-400">v{__APP_VERSION__}</span>
              </h1>
              <ApiModeBadge />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <SnapshotButtons />
            <CreateProfileButton />
            <ImportProfileButton />
            <SignInButton />
            <MarketplaceLink />
            <DocsLink />
          </div>
        </header>

        <section className="-ml-4 flex min-h-0 w-full gap-4 overflow-hidden pt-4">
          <ProfilesDrawer
            onApplyProfile={(name) => {
              setPublishProfileName(null);
              setViewProfileName(null);
              setEditProfileName(null);
              setApplyProfileName(name);
            }}
            onPublishProfile={(name) => {
              setApplyProfileName(null);
              setViewProfileName(null);
              setEditProfileName(null);
              setPublishProfileName(name);
            }}
            onViewProfile={(name) => {
              setApplyProfileName(null);
              setPublishProfileName(null);
              setEditProfileName(null);
              setViewProfileName(name);
            }}
            onEditProfile={(name) => {
              setApplyProfileName(null);
              setPublishProfileName(null);
              setViewProfileName(null);
              setEditProfileName(name);
            }}
          />
          <div className="scrollbar-none min-w-0 flex-1 overflow-y-auto pr-1">
            {publishProfileName ? (
              <PublishProfilePanel
                profileName={publishProfileName}
                onCancel={() => setPublishProfileName(null)}
                onPublished={() => {
                  window.dispatchEvent(new CustomEvent('brainctl:profiles-changed'));
                }}
                onEdit={(name) => {
                  setPublishProfileName(null);
                  setEditProfileName(name);
                }}
              />
            ) : applyProfileName ? (
              <ApplyProfilePanel
                initialProfile={applyProfileName}
                onCancel={() => setApplyProfileName(null)}
                onApplied={() => {
                  window.dispatchEvent(new CustomEvent('brainctl:profiles-changed'));
                }}
              />
            ) : editProfileName ? (
              <EditProfilePanel
                profileName={editProfileName}
                onCancel={() => setEditProfileName(null)}
                onChanged={() => {
                  window.dispatchEvent(new CustomEvent('brainctl:profiles-changed'));
                }}
              />
            ) : viewProfileName ? (
              <ViewProfilePanel
                profileName={viewProfileName}
                onCancel={() => setViewProfileName(null)}
                onApply={(name) => {
                  setViewProfileName(null);
                  setApplyProfileName(name);
                }}
                onPublish={(name) => {
                  setViewProfileName(null);
                  setPublishProfileName(name);
                }}
                onEdit={(name) => {
                  setViewProfileName(null);
                  setEditProfileName(name);
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
