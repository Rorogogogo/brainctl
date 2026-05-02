import { useCallback, useEffect, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  Loader2,
  RefreshCw,
  Zap,
} from 'lucide-react';

import { AgentLogo } from '../components/agent-brand';

const AGENTS = ['claude', 'codex', 'gemini'] as const;
type Agent = typeof AGENTS[number];
type ItemType = 'mcp' | 'plugin' | 'skill';

interface ProfileSummary {
  name: string;
}

interface ProfileContents {
  profile: {
    name: string;
    description?: string;
    mcps: Record<string, unknown>;
  };
  manifest: {
    plugins?: Array<{ agent: Agent; name: string }>;
    userSkills?: Array<{ agent: Agent; name: string }>;
  } | null;
}

interface DrawerItem {
  type: ItemType;
  name: string;
  agent?: Agent; // plugins/skills are agent-scoped
}

interface ApplyState {
  status: 'idle' | 'pending' | 'success' | 'error';
  message?: string;
}

interface ApplyAllState {
  status: 'idle' | 'pending' | 'success' | 'error';
  message?: string;
  backups?: Array<{ agent: Agent; profileName: string }>;
}

export default function ProfilesDrawer() {
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [contents, setContents] = useState<Record<string, ProfileContents>>({});
  const [applyState, setApplyState] = useState<Record<string, ApplyState>>({});
  const [applyAllState, setApplyAllState] = useState<Record<string, ApplyAllState>>({});
  const [loading, setLoading] = useState(true);
  const [refreshState, setRefreshState] = useState<'idle' | 'loading' | 'success'>('idle');

  const loadProfiles = useCallback(async () => {
    try {
      const r = await fetch('/api/profiles');
      const data = (await r.json()) as { profiles: string[] };
      setProfiles(data.profiles.map((name) => ({ name })));
    } catch {
      setProfiles([]);
    }
  }, []);

  const handleRefresh = useCallback(async () => {
    setRefreshState('loading');
    await loadProfiles();
    // refetch contents for any expanded profile
    const expandedNames = Array.from(expanded);
    const fresh: Record<string, ProfileContents> = {};
    await Promise.all(
      expandedNames.map(async (name) => {
        try {
          const r = await fetch(`/api/profiles/${encodeURIComponent(name)}/contents`);
          fresh[name] = (await r.json()) as ProfileContents;
        } catch {
          // skip
        }
      })
    );
    setContents((prev) => ({ ...prev, ...fresh }));
    setRefreshState('success');
    setTimeout(() => setRefreshState('idle'), 1200);
  }, [expanded, loadProfiles]);

  useEffect(() => {
    void (async () => {
      await loadProfiles();
      setLoading(false);
    })();
  }, [loadProfiles]);

  useEffect(() => {
    const onChanged = () => void handleRefresh();
    window.addEventListener('brainctl:profiles-changed', onChanged);
    return () => window.removeEventListener('brainctl:profiles-changed', onChanged);
  }, [handleRefresh]);

  async function openFolder(profileName: string) {
    try {
      const r = await fetch(`/api/profiles/${encodeURIComponent(profileName)}/open-folder`, {
        method: 'POST',
      });
      if (!r.ok) {
        const data = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `HTTP ${r.status}`);
      }
    } catch (err) {
      window.alert(`Open folder failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function toggle(name: string) {
    const next = new Set(expanded);
    if (next.has(name)) {
      next.delete(name);
      setExpanded(next);
      return;
    }
    next.add(name);
    setExpanded(next);
    if (!contents[name]) {
      try {
        const r = await fetch(`/api/profiles/${encodeURIComponent(name)}/contents`);
        const data = (await r.json()) as ProfileContents;
        setContents((prev) => ({ ...prev, [name]: data }));
      } catch {
        // ignore
      }
    }
  }

  async function applyAll(profileName: string) {
    setApplyAllState((prev) => ({ ...prev, [profileName]: { status: 'pending' } }));
    try {
      const r = await fetch(`/api/profiles/${encodeURIComponent(profileName)}/apply`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ agents: AGENTS, backup: true }),
      });
      if (!r.ok) {
        const data = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `HTTP ${r.status}`);
      }
      const data = (await r.json()) as {
        backups?: Array<{ agent: Agent; profileName: string }>;
      };
      setApplyAllState((prev) => ({
        ...prev,
        [profileName]: { status: 'success', backups: data.backups ?? [] },
      }));
      window.dispatchEvent(new CustomEvent('brainctl:profiles-changed'));
      setTimeout(() => {
        setApplyAllState((prev) => {
          const copy = { ...prev };
          delete copy[profileName];
          return copy;
        });
      }, 8000);
    } catch (err) {
      setApplyAllState((prev) => ({
        ...prev,
        [profileName]: {
          status: 'error',
          message: err instanceof Error ? err.message : 'Apply failed',
        },
      }));
    }
  }

  async function apply(profileName: string, item: DrawerItem, agent: Agent) {
    const key = `${profileName}::${item.type}:${item.name}->${agent}`;
    setApplyState((prev) => ({ ...prev, [key]: { status: 'pending' } }));
    try {
      const r = await fetch(`/api/profiles/${encodeURIComponent(profileName)}/apply`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          agents: [agent],
          items: [{ type: item.type, name: item.name }],
          backup: false,
        }),
      });
      if (!r.ok) {
        const data = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `HTTP ${r.status}`);
      }
      setApplyState((prev) => ({ ...prev, [key]: { status: 'success' } }));
      setTimeout(
        () =>
          setApplyState((prev) => {
            const copy = { ...prev };
            delete copy[key];
            return copy;
          }),
        2000
      );
    } catch (err) {
      setApplyState((prev) => ({
        ...prev,
        [key]: {
          status: 'error',
          message: err instanceof Error ? err.message : 'Apply failed',
        },
      }));
    }
  }

  if (loading) {
    return (
      <aside className="flex w-72 flex-col gap-2 border-r border-zinc-200 bg-white p-3 text-xs">
        <Loader2 className="size-4 animate-spin text-zinc-400" />
      </aside>
    );
  }

  return (
    <aside className="flex w-72 flex-col gap-2 border-r border-zinc-200 bg-white p-3 text-xs">
      <div className="flex items-center justify-between px-1">
        <h2 className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
          Profiles
        </h2>
        <button
          type="button"
          onClick={() => void handleRefresh()}
          disabled={refreshState === 'loading'}
          title="Reload profiles list"
          className={`grid size-5 place-items-center rounded transition ${
            refreshState === 'success'
              ? 'bg-emerald-100 text-emerald-700'
              : 'text-zinc-500 hover:bg-zinc-100'
          }`}
        >
          {refreshState === 'loading' ? (
            <Loader2 size={11} className="animate-spin" />
          ) : refreshState === 'success' ? (
            <Check size={11} />
          ) : (
            <RefreshCw size={11} />
          )}
        </button>
      </div>
      {profiles.length === 0 && (
        <div className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50/60 px-3 py-3 text-zinc-500">
          <p className="font-medium text-zinc-700">No profiles yet.</p>
          <p className="mt-1 text-[11px] leading-snug">
            Use the <span className="font-mono text-zinc-700">Snapshot</span> buttons above to
            capture a live agent's state, or run:
          </p>
          <ul className="mt-1.5 space-y-1 font-mono text-[10px] text-zinc-600">
            <li>brainctl profile create &lt;name&gt;</li>
            <li>brainctl profile import ./shared-profile</li>
          </ul>
        </div>
      )}
      <ul className="flex flex-col gap-1">
        {profiles.map((p) => (
          <li key={p.name} className="rounded-lg border border-zinc-200 bg-zinc-50">
            <div className="flex items-center gap-1 px-1 py-1">
              <button
                type="button"
                onClick={() => void toggle(p.name)}
                className="flex flex-1 items-center gap-2 rounded-md px-1 py-0.5 text-left font-medium text-zinc-800 hover:bg-zinc-100"
              >
                {expanded.has(p.name) ? (
                  <ChevronDown size={12} />
                ) : (
                  <ChevronRight size={12} />
                )}
                <Folder size={12} className="text-zinc-500" />
                <span className="truncate">{p.name}</span>
              </button>
              <button
                type="button"
                onClick={() => void openFolder(p.name)}
                title="Open profile folder in Finder"
                className="grid size-5 place-items-center rounded text-zinc-500 transition hover:bg-zinc-100"
              >
                <FolderOpen size={11} />
              </button>
              <ApplyAllButton
                state={applyAllState[p.name]}
                onClick={() => void applyAll(p.name)}
              />
            </div>
            {applyAllState[p.name]?.status === 'success' &&
              (applyAllState[p.name]?.backups?.length ?? 0) > 0 && (
                <div className="border-t border-emerald-200 bg-emerald-50 px-2 py-1.5 text-[10px] text-emerald-800">
                  <div className="font-semibold uppercase tracking-wide">Backed up</div>
                  <ul className="mt-1 space-y-0.5">
                    {(applyAllState[p.name]?.backups ?? []).map((b) => (
                      <li key={b.profileName} className="font-mono">
                        {b.profileName}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            {applyAllState[p.name]?.status === 'error' && (
              <div className="border-t border-rose-200 bg-rose-50 px-2 py-1.5 text-[10px] text-rose-800">
                {applyAllState[p.name]?.message ?? 'Apply failed'}
              </div>
            )}
            {expanded.has(p.name) && (
              <div className="border-t border-zinc-200 px-2 py-1.5">
                <ProfileItems
                  profileName={p.name}
                  contents={contents[p.name]}
                  applyState={applyState}
                  onApply={apply}
                />
              </div>
            )}
          </li>
        ))}
      </ul>
    </aside>
  );
}

function ApplyAllButton({
  state,
  onClick,
}: {
  state: ApplyAllState | undefined;
  onClick: () => void;
}) {
  const status = state?.status ?? 'idle';
  const tooltip =
    status === 'success' && state?.backups && state.backups.length > 0
      ? `Applied. Backups: ${state.backups.map((b) => b.profileName).join(', ')}`
      : status === 'error'
        ? state?.message ?? 'Apply failed'
        : 'Apply this entire profile to all 3 agents (with backup)';

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={status === 'pending'}
      title={tooltip}
      className={`grid size-5 place-items-center rounded transition ${
        status === 'success'
          ? 'bg-emerald-100 text-emerald-700'
          : status === 'error'
            ? 'bg-rose-100 text-rose-700'
            : status === 'pending'
              ? 'bg-zinc-100 text-zinc-500'
              : 'text-zinc-500 hover:bg-zinc-100'
      }`}
    >
      {status === 'pending' ? (
        <Loader2 size={11} className="animate-spin" />
      ) : status === 'success' ? (
        <Check size={11} />
      ) : (
        <Zap size={11} />
      )}
    </button>
  );
}

function ProfileItems({
  profileName,
  contents,
  applyState,
  onApply,
}: {
  profileName: string;
  contents: ProfileContents | undefined;
  applyState: Record<string, ApplyState>;
  onApply: (profileName: string, item: DrawerItem, agent: Agent) => void | Promise<void>;
}) {
  if (!contents) {
    return <Loader2 className="size-3 animate-spin text-zinc-400" />;
  }

  const mcps = Object.keys(contents.profile.mcps ?? {});
  const plugins = contents.manifest?.plugins ?? [];
  const skills = contents.manifest?.userSkills ?? [];

  if (mcps.length === 0 && plugins.length === 0 && skills.length === 0) {
    return <p className="text-zinc-400">Profile is empty.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {mcps.length > 0 && (
        <Group label="MCPs">
          {mcps.map((name) => (
            <Item
              key={`mcp-${name}`}
              label={name}
              applyState={applyState}
              applyKeyPrefix={`${profileName}::mcp:${name}`}
              onApply={(agent) => onApply(profileName, { type: 'mcp', name }, agent)}
              dragPayload={{ profileName, type: 'mcp', name }}
            />
          ))}
        </Group>
      )}
      {plugins.length > 0 && (
        <Group label="Plugins">
          {plugins.map((p) => (
            <Item
              key={`plugin-${p.agent}-${p.name}`}
              label={`${p.name} (${p.agent})`}
              applyState={applyState}
              applyKeyPrefix={`${profileName}::plugin:${p.name}`}
              singleAgent={p.agent}
              onApply={(agent) =>
                onApply(profileName, { type: 'plugin', name: p.name, agent: p.agent }, agent)
              }
              dragPayload={{ profileName, type: 'plugin', name: p.name, agent: p.agent }}
            />
          ))}
        </Group>
      )}
      {skills.length > 0 && (
        <Group label="Skills">
          {skills.map((s) => (
            <Item
              key={`skill-${s.agent}-${s.name}`}
              label={`${s.name} (${s.agent})`}
              applyState={applyState}
              applyKeyPrefix={`${profileName}::skill:${s.name}`}
              singleAgent={s.agent}
              onApply={(agent) =>
                onApply(profileName, { type: 'skill', name: s.name, agent: s.agent }, agent)
              }
              dragPayload={{ profileName, type: 'skill', name: s.name, agent: s.agent }}
            />
          ))}
        </Group>
      )}
    </div>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="text-[9px] font-semibold uppercase tracking-wide text-zinc-400">
        {label}
      </div>
      <div className="flex flex-col gap-1">{children}</div>
    </div>
  );
}

function Item({
  label,
  applyState,
  applyKeyPrefix,
  singleAgent,
  onApply,
  dragPayload,
}: {
  label: string;
  applyState: Record<string, ApplyState>;
  applyKeyPrefix: string;
  singleAgent?: Agent;
  onApply: (agent: Agent) => void | Promise<void>;
  dragPayload: { profileName: string; type: ItemType; name: string; agent?: Agent };
}) {
  const targets = singleAgent ? [singleAgent] : AGENTS;

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(
          'application/x-brainctl-apply',
          JSON.stringify(dragPayload)
        );
        e.dataTransfer.effectAllowed = 'copy';
      }}
      className="flex items-center justify-between gap-2 rounded-md border border-zinc-200 bg-white px-2 py-1 cursor-grab active:cursor-grabbing"
    >
      <span className="truncate font-medium text-zinc-800">{label}</span>
      <div className="flex items-center gap-1">
        {targets.map((agent) => {
          const state = applyState[`${applyKeyPrefix}->${agent}`];
          const status = state?.status ?? 'idle';
          return (
            <button
              key={agent}
              type="button"
              onClick={() => void onApply(agent)}
              title={
                state?.message
                  ? `${agent}: ${state.message}`
                  : `Apply to ${agent}`
              }
              disabled={status === 'pending'}
              className={`grid size-5 place-items-center rounded transition ${
                status === 'success'
                  ? 'bg-emerald-100'
                  : status === 'error'
                    ? 'bg-rose-100'
                    : status === 'pending'
                      ? 'bg-zinc-100'
                      : 'bg-zinc-50 hover:bg-zinc-100'
              }`}
            >
              <span className="grid size-3 place-items-center overflow-hidden">
                <AgentLogo agent={agent} className="size-full object-contain" />
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
