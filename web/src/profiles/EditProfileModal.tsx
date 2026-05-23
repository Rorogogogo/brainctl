import * as Dialog from '@radix-ui/react-dialog';
import { Loader2, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { AgentLogo } from '../components/agent-brand';

type Agent = 'claude' | 'codex' | 'antigravity';
type ItemType = 'mcp' | 'plugin' | 'skill';

const ALL_AGENTS: Agent[] = ['claude', 'codex', 'antigravity'];

interface ProfileContents {
  profile: {
    name: string;
    mcps: Record<string, unknown>;
  };
  manifest: {
    plugins?: Array<{ agent: Agent; name: string }>;
    userSkills?: Array<{ agent: Agent; name: string }>;
  } | null;
}

interface AgentLive {
  agent: Agent;
  exists: boolean;
  mcpServers: Record<string, unknown>;
  remoteMcpServers: Record<string, unknown>;
  skills: Array<{ name: string; kind?: 'skill' | 'plugin'; installPath?: string }>;
}

interface PickerCandidate {
  type: ItemType;
  agent: Agent;
  name: string;
}

export interface EditProfileModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profileName: string | null;
  onChanged: () => void;
}

export default function EditProfileModal({
  open,
  onOpenChange,
  profileName,
  onChanged,
}: EditProfileModalProps) {
  const [contents, setContents] = useState<ProfileContents | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [picker, setPicker] = useState<{ type: ItemType } | null>(null);

  const loadContents = async (): Promise<void> => {
    if (!profileName) return;
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/profiles/${encodeURIComponent(profileName)}/contents`);
      if (!r.ok) {
        const data = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `HTTP ${r.status}`);
      }
      setContents((await r.json()) as ProfileContents);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load profile');
      setContents(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) {
      setError(null);
      setContents(null);
      setPicker(null);
      setBusyKey(null);
      return;
    }
    void loadContents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, profileName]);

  async function removeItem(item: { type: ItemType; name: string; agent?: Agent }) {
    if (!profileName) return;
    const k = `del:${item.type}:${item.name}:${item.agent ?? ''}`;
    setBusyKey(k);
    setError(null);
    try {
      await deleteProfileItem(profileName, item);
      await loadContents();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Remove failed');
    } finally {
      setBusyKey(null);
    }
  }

  async function removeItems(
    type: ItemType,
    items: Array<{ type: ItemType; name: string; agent?: Agent }>
  ) {
    if (!profileName || items.length === 0) return;
    const k = `del-all:${type}`;
    setBusyKey(k);
    setError(null);
    try {
      for (const item of items) {
        await deleteProfileItem(profileName, item);
      }
      await loadContents();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete all failed');
    } finally {
      setBusyKey(null);
    }
  }

  async function addItem(candidate: PickerCandidate) {
    if (!profileName) return;
    const k = `add:${candidate.type}:${candidate.name}:${candidate.agent}`;
    setBusyKey(k);
    setError(null);
    try {
      const r = await fetch(`/api/profiles/${encodeURIComponent(profileName)}/items`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: candidate.type,
          agent: candidate.agent,
          name: candidate.name,
        }),
      });
      if (!r.ok) {
        const data = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `HTTP ${r.status}`);
      }
      await loadContents();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Add failed');
    } finally {
      setBusyKey(null);
    }
  }

  const sections = useMemo(() => {
    if (!contents) return null;
    return {
      mcps: Object.keys(contents.profile.mcps ?? {}),
      plugins: contents.manifest?.plugins ?? [],
      skills: contents.manifest?.userSkills ?? [],
    };
  }, [contents]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[88vh] w-full max-w-3xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border border-zinc-200/80 bg-white p-6 shadow-xl">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-lg font-semibold tracking-tight text-zinc-900">
                Edit profile{profileName ? ` — ${profileName}` : ''}
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-zinc-500">
                Add or remove MCPs, plugins, and skills. Items are copied from your live
                agent configs into the profile.
              </Dialog.Description>
            </div>
          </div>

          {error && (
            <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
              {error}
            </div>
          )}

          <div className="scrollbar-none mt-4 min-h-0 flex-1 overflow-y-auto">
            {loading || !sections ? (
              <p className="inline-flex items-center gap-2 text-sm text-zinc-500">
                <Loader2 size={14} className="animate-spin" /> Loading…
              </p>
            ) : (
              <div className="flex flex-col gap-4">
                <Section
                  label="Skills"
                  count={sections.skills.length}
                  onAdd={() => {
                    setError(null);
                    setPicker({ type: 'skill' });
                  }}
                  onRemoveAll={() =>
                    void removeItems(
                      'skill',
                      sections.skills.map((s) => ({
                        type: 'skill',
                        name: s.name,
                        agent: s.agent,
                      }))
                    )
                  }
                  removeAllBusy={busyKey === 'del-all:skill'}
                  empty="No skills in this profile yet."
                >
                  {sections.skills.map((s) => (
                    <Row
                      key={`skill-${s.agent}-${s.name}`}
                      label={s.name}
                      agentBadge={s.agent}
                      busy={busyKey === `del:skill:${s.name}:${s.agent}`}
                      onRemove={() =>
                        void removeItem({ type: 'skill', name: s.name, agent: s.agent })
                      }
                    />
                  ))}
                </Section>

                <Section
                  label="MCPs"
                  count={sections.mcps.length}
                  onAdd={() => {
                    setError(null);
                    setPicker({ type: 'mcp' });
                  }}
                  onRemoveAll={() =>
                    void removeItems(
                      'mcp',
                      sections.mcps.map((name) => ({ type: 'mcp', name }))
                    )
                  }
                  removeAllBusy={busyKey === 'del-all:mcp'}
                  empty="No MCPs in this profile yet."
                >
                  {sections.mcps.map((name) => (
                    <Row
                      key={`mcp-${name}`}
                      label={name}
                      busy={busyKey === `del:mcp:${name}:`}
                      onRemove={() => void removeItem({ type: 'mcp', name })}
                    />
                  ))}
                </Section>

                <Section
                  label="Plugins"
                  count={sections.plugins.length}
                  onAdd={() => {
                    setError(null);
                    setPicker({ type: 'plugin' });
                  }}
                  onRemoveAll={() =>
                    void removeItems(
                      'plugin',
                      sections.plugins.map((p) => ({
                        type: 'plugin',
                        name: p.name,
                        agent: p.agent,
                      }))
                    )
                  }
                  removeAllBusy={busyKey === 'del-all:plugin'}
                  empty="No plugins in this profile yet."
                >
                  {sections.plugins.map((p) => (
                    <Row
                      key={`plugin-${p.agent}-${p.name}`}
                      label={p.name}
                      agentBadge={p.agent}
                      busy={busyKey === `del:plugin:${p.name}:${p.agent}`}
                      onRemove={() =>
                        void removeItem({ type: 'plugin', name: p.name, agent: p.agent })
                      }
                    />
                  ))}
                </Section>
              </div>
            )}
          </div>

          <div className="mt-5 flex items-center justify-end gap-3">
            <Dialog.Close asChild>
              <button
                type="button"
                className="inline-flex min-h-[36px] items-center justify-center rounded-lg border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-700 shadow-sm transition-all hover:bg-zinc-50 hover:text-zinc-900"
              >
                Done
              </button>
            </Dialog.Close>
          </div>

          {picker && contents && (
            <AddPicker
              type={picker.type}
              existing={existingKeys(contents, picker.type)}
              busyKey={busyKey}
              addError={error}
              onClose={() => setPicker(null)}
              onAdd={async (c) => {
                await addItem(c);
              }}
            />
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function existingKeys(contents: ProfileContents, type: ItemType): Set<string> {
  if (type === 'mcp') {
    return new Set(Object.keys(contents.profile.mcps ?? {}).map((n) => `mcp::${n}`));
  }
  if (type === 'plugin') {
    return new Set(
      (contents.manifest?.plugins ?? []).map((p) => `plugin::${p.agent}::${p.name}`)
    );
  }
  return new Set(
    (contents.manifest?.userSkills ?? []).map((s) => `skill::${s.agent}::${s.name}`)
  );
}

async function deleteProfileItem(
  profileName: string,
  item: { type: ItemType; name: string; agent?: Agent }
): Promise<void> {
  const params = new URLSearchParams({ type: item.type, name: item.name });
  if (item.agent) params.set('agent', item.agent);
  const r = await fetch(
    `/api/profiles/${encodeURIComponent(profileName)}/items?${params.toString()}`,
    { method: 'DELETE' }
  );
  if (!r.ok) {
    const data = (await r.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `HTTP ${r.status}`);
  }
}

function Section({
  label,
  count,
  onAdd,
  onRemoveAll,
  removeAllBusy,
  children,
  empty,
}: {
  label: string;
  count: number;
  onAdd: () => void;
  onRemoveAll: () => void;
  removeAllBusy?: boolean;
  children: ReactNode;
  empty: string;
}) {
  return (
    <section>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
          {label} ({count})
        </span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onRemoveAll}
            disabled={count === 0 || removeAllBusy}
            className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-white px-2 py-1 text-[11px] font-medium text-rose-700 shadow-sm transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {removeAllBusy ? (
              <Loader2 size={11} className="animate-spin" />
            ) : (
              <Trash2 size={11} />
            )}
            Delete all
          </button>
          <button
            type="button"
            onClick={onAdd}
            className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-white px-2 py-1 text-[11px] font-medium text-zinc-700 shadow-sm transition hover:bg-zinc-50"
          >
            <Plus size={11} /> Add from live agent
          </button>
        </div>
      </div>
      <div className="rounded-lg border border-zinc-200 bg-zinc-50/40 p-2">
        {count === 0 ? (
          <p className="px-1 py-0.5 text-xs text-zinc-500">{empty}</p>
        ) : (
          <ul className="flex flex-col gap-1">{children}</ul>
        )}
      </div>
    </section>
  );
}

function Row({
  label,
  agentBadge,
  busy,
  onRemove,
}: {
  label: string;
  agentBadge?: Agent;
  busy?: boolean;
  onRemove: () => void;
}) {
  return (
    <li className="flex items-center gap-2 rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm">
      {agentBadge && (
        <span className="grid size-4 place-items-center overflow-hidden" title={agentBadge}>
          <AgentLogo agent={agentBadge} className="size-full object-contain" />
        </span>
      )}
      <span className="flex-1 truncate font-medium text-zinc-800">{label}</span>
      <button
        type="button"
        onClick={onRemove}
        disabled={busy}
        className="grid size-6 place-items-center rounded text-zinc-500 transition hover:bg-rose-100 hover:text-rose-700 disabled:opacity-50"
        title="Remove from profile"
      >
        {busy ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />}
      </button>
    </li>
  );
}

function AddPicker({
  type,
  existing,
  busyKey,
  addError,
  onClose,
  onAdd,
}: {
  type: ItemType;
  existing: Set<string>;
  busyKey: string | null;
  addError: string | null;
  onClose: () => void;
  onAdd: (c: PickerCandidate) => Promise<void>;
}) {
  const [live, setLive] = useState<AgentLive[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let aborted = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const r = await fetch('/api/agents/live');
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = (await r.json()) as AgentLive[];
        if (!aborted) setLive(data);
      } catch (err) {
        if (!aborted) setError(err instanceof Error ? err.message : 'Failed to load');
      } finally {
        if (!aborted) setLoading(false);
      }
    })();
    return () => {
      aborted = true;
    };
  }, []);

  const candidates = useMemo<PickerCandidate[]>(() => {
    if (!live) return [];
    const out: PickerCandidate[] = [];
    for (const cfg of live) {
      if (!cfg.exists) continue;
      if (type === 'mcp') {
        const names = new Set([
          ...Object.keys(cfg.mcpServers ?? {}),
          ...Object.keys(cfg.remoteMcpServers ?? {}),
        ]);
        for (const name of names) {
          out.push({ type: 'mcp', agent: cfg.agent, name });
        }
      } else {
        for (const skill of cfg.skills ?? []) {
          if (type === 'plugin' && skill.kind !== 'plugin') continue;
          if (type === 'skill' && skill.kind === 'plugin') continue;
          if (!skill.installPath) continue;
          out.push({ type, agent: cfg.agent, name: skill.name });
        }
      }
    }
    return out;
  }, [live, type]);

  const grouped = useMemo(() => {
    const map = new Map<Agent, PickerCandidate[]>();
    for (const a of ALL_AGENTS) map.set(a, []);
    for (const c of candidates) map.get(c.agent)?.push(c);
    for (const a of ALL_AGENTS) {
      const list = map.get(a)!;
      list.sort((a, b) => a.name.localeCompare(b.name));
    }
    return map;
  }, [candidates]);

  return (
    <div
      className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-black/30 p-6"
      onClick={onClose}
    >
      <div
        className="flex max-h-full w-full max-w-lg flex-col rounded-xl border border-zinc-200 bg-white p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-zinc-900">
            Add{' '}
            {type === 'mcp' ? 'MCP' : type === 'plugin' ? 'plugin' : 'skill'} from a live
            agent
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="grid size-6 place-items-center rounded text-zinc-500 hover:bg-zinc-100"
          >
            <X size={12} />
          </button>
        </div>
        {(error || addError) && (
          <div className="mb-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
            {error ?? addError}
          </div>
        )}
        <div className="scrollbar-none flex-1 overflow-y-auto">
          {loading ? (
            <p className="inline-flex items-center gap-2 text-sm text-zinc-500">
              <Loader2 size={14} className="animate-spin" /> Loading…
            </p>
          ) : candidates.length === 0 ? (
            <p className="text-sm text-zinc-500">
              No {type}s available in any live agent config.
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {ALL_AGENTS.map((agent) => {
                const items = grouped.get(agent) ?? [];
                if (items.length === 0) return null;
                return (
                  <div key={agent}>
                    <div className="mb-1 flex items-center gap-2">
                      <span className="grid size-4 place-items-center overflow-hidden">
                        <AgentLogo agent={agent} className="size-full object-contain" />
                      </span>
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                        {agent} ({items.length})
                      </span>
                    </div>
                    <ul className="flex flex-col gap-1">
                      {items.map((item) => {
                        const k =
                          item.type === 'mcp'
                            ? `mcp::${item.name}`
                            : `${item.type}::${item.agent}::${item.name}`;
                        const already = existing.has(k);
                        const adding = busyKey === `add:${item.type}:${item.name}:${item.agent}`;
                        return (
                          <li key={k}>
                            <button
                              type="button"
                              onClick={() => onAdd(item)}
                              disabled={already || adding}
                              className="flex w-full items-center gap-2 rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-left text-sm text-zinc-800 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <span className="flex-1 truncate font-medium">{item.name}</span>
                              {already ? (
                                <span className="text-[11px] text-zinc-400">Already in profile</span>
                              ) : adding ? (
                                <Loader2 size={12} className="animate-spin text-zinc-500" />
                              ) : (
                                <Plus size={12} className="text-zinc-500" />
                              )}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
