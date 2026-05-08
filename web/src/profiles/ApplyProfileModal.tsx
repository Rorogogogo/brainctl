import * as Dialog from '@radix-ui/react-dialog';
import { Loader2, Wand2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { AgentLogo } from '../components/agent-brand';

type Agent = 'claude' | 'codex' | 'gemini';
type ItemType = 'mcp' | 'plugin' | 'skill';

const ALL_AGENTS: Agent[] = ['claude', 'codex', 'gemini'];

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

interface SelectableItem {
  type: ItemType;
  name: string;
  agentBadges: Agent[];
}

export interface ApplyProfileModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profiles: string[];
  initialProfile: string | null;
  onApplied: () => void;
}

export default function ApplyProfileModal({
  open,
  onOpenChange,
  profiles,
  initialProfile,
  onApplied,
}: ApplyProfileModalProps) {
  const [selectedProfile, setSelectedProfile] = useState<string | null>(initialProfile);
  const [contents, setContents] = useState<ProfileContents | null>(null);
  const [loadingContents, setLoadingContents] = useState(false);
  const [agents, setAgents] = useState<Set<Agent>>(new Set(ALL_AGENTS));
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{
    backups: Array<{ agent: Agent; profileName: string }>;
  } | null>(null);

  useEffect(() => {
    if (!open) {
      setError(null);
      setBusy(false);
      setSuccess(null);
      return;
    }
    setSelectedProfile(initialProfile);
    setAgents(new Set(ALL_AGENTS));
    setExcluded(new Set());
    setSuccess(null);
  }, [open, initialProfile]);

  useEffect(() => {
    if (!open || !selectedProfile) {
      setContents(null);
      return;
    }
    let aborted = false;
    setLoadingContents(true);
    setError(null);
    void (async () => {
      try {
        const r = await fetch(
          `/api/profiles/${encodeURIComponent(selectedProfile)}/contents`
        );
        if (!r.ok) {
          const data = (await r.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error ?? `HTTP ${r.status}`);
        }
        const data = (await r.json()) as ProfileContents;
        if (!aborted) {
          setContents(data);
          setExcluded(new Set());
        }
      } catch (err) {
        if (!aborted) {
          setContents(null);
          setError(err instanceof Error ? err.message : 'Failed to load profile');
        }
      } finally {
        if (!aborted) setLoadingContents(false);
      }
    })();
    return () => {
      aborted = true;
    };
  }, [open, selectedProfile]);

  const items = useMemo<{ mcps: SelectableItem[]; plugins: SelectableItem[]; skills: SelectableItem[] }>(() => {
    if (!contents) return { mcps: [], plugins: [], skills: [] };
    const mcps: SelectableItem[] = Object.keys(contents.profile.mcps ?? {}).map((name) => ({
      type: 'mcp',
      name,
      agentBadges: [],
    }));
    const pluginMap = new Map<string, Set<Agent>>();
    for (const p of contents.manifest?.plugins ?? []) {
      const set = pluginMap.get(p.name) ?? new Set<Agent>();
      set.add(p.agent);
      pluginMap.set(p.name, set);
    }
    const plugins: SelectableItem[] = Array.from(pluginMap.entries()).map(([name, set]) => ({
      type: 'plugin',
      name,
      agentBadges: Array.from(set).sort(),
    }));
    const skillMap = new Map<string, Set<Agent>>();
    for (const s of contents.manifest?.userSkills ?? []) {
      const set = skillMap.get(s.name) ?? new Set<Agent>();
      set.add(s.agent);
      skillMap.set(s.name, set);
    }
    const skills: SelectableItem[] = Array.from(skillMap.entries()).map(([name, set]) => ({
      type: 'skill',
      name,
      agentBadges: Array.from(set).sort(),
    }));
    return { mcps, plugins, skills };
  }, [contents]);

  const allItems = [...items.mcps, ...items.plugins, ...items.skills];
  const includedCount = allItems.filter((i) => !excluded.has(itemKey(i))).length;
  const isEmpty =
    contents !== null && allItems.length === 0;

  function toggleAgent(agent: Agent) {
    const next = new Set(agents);
    if (next.has(agent)) next.delete(agent);
    else next.add(agent);
    setAgents(next);
  }

  function toggleItem(item: SelectableItem) {
    const next = new Set(excluded);
    const k = itemKey(item);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    setExcluded(next);
  }

  function toggleAllInGroup(group: SelectableItem[]) {
    const groupKeys = group.map(itemKey);
    const allSelected = groupKeys.every((k) => !excluded.has(k));
    const next = new Set(excluded);
    if (allSelected) {
      for (const k of groupKeys) next.add(k);
    } else {
      for (const k of groupKeys) next.delete(k);
    }
    setExcluded(next);
  }

  async function apply() {
    if (!selectedProfile) {
      setError('Pick a profile first.');
      return;
    }
    if (agents.size === 0) {
      setError('Select at least one agent.');
      return;
    }
    if (allItems.length > 0 && includedCount === 0) {
      setError('Select at least one item to apply.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const filtered = allItems.filter((i) => !excluded.has(itemKey(i)));
      const itemsPayload =
        filtered.length === allItems.length
          ? undefined
          : filtered.map((i) => ({ type: i.type, name: i.name }));
      const r = await fetch(
        `/api/profiles/${encodeURIComponent(selectedProfile)}/apply`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            agents: Array.from(agents),
            ...(itemsPayload ? { items: itemsPayload } : {}),
          }),
        }
      );
      if (!r.ok) {
        const data = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `HTTP ${r.status}`);
      }
      const result = (await r.json().catch(() => ({}))) as {
        backups?: Array<{ agent: Agent; profileName: string }>;
      };
      setSuccess({ backups: result.backups ?? [] });
      onApplied();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Apply failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-full max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border border-zinc-200/80 bg-white p-6 shadow-xl">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-lg font-semibold tracking-tight text-zinc-900">
                Apply profile
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-zinc-500">
                Apply makes each agent match this profile — items not in the profile are
                removed. Before any write, a snapshot of each agent's current state is
                saved as a <span className="font-mono">backup-&lt;agent&gt;-&lt;timestamp&gt;</span>{' '}
                profile so you can revert.
              </Dialog.Description>
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-1 text-sm">
            <span className="font-medium text-zinc-700">Profile</span>
            <select
              className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-400 focus:outline-none disabled:opacity-60"
              value={selectedProfile ?? ''}
              onChange={(e) => setSelectedProfile(e.target.value || null)}
              disabled={busy}
            >
              <option value="" disabled>
                {profiles.length === 0 ? 'No profiles yet' : 'Choose a profile…'}
              </option>
              {profiles.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>

          <div className="mt-3 flex flex-col gap-1 text-sm">
            <span className="font-medium text-zinc-700">Apply to agents</span>
            <div className="flex flex-wrap gap-2">
              {ALL_AGENTS.map((agent) => {
                const checked = agents.has(agent);
                return (
                  <button
                    key={agent}
                    type="button"
                    onClick={() => toggleAgent(agent)}
                    disabled={busy}
                    className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium transition ${
                      checked
                        ? 'border-zinc-900 bg-zinc-900 text-white shadow-sm'
                        : 'border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50'
                    }`}
                  >
                    <span className="grid size-3.5 place-items-center overflow-hidden">
                      <AgentLogo agent={agent} className="size-full object-contain" />
                    </span>
                    <span className="capitalize">{agent}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-3 min-h-0 flex-1 overflow-y-auto rounded-lg border border-zinc-200 bg-zinc-50/40 p-3 text-sm">
            {!selectedProfile ? (
              <p className="text-zinc-500">Pick a profile to see its contents.</p>
            ) : loadingContents ? (
              <p className="inline-flex items-center gap-2 text-zinc-500">
                <Loader2 size={14} className="animate-spin" /> Loading…
              </p>
            ) : isEmpty ? (
              <p className="text-zinc-500">This profile has no items to apply.</p>
            ) : (
              <div className="flex flex-col gap-3">
                <ItemGroup
                  label="Skills"
                  items={items.skills}
                  excluded={excluded}
                  onToggle={toggleItem}
                  onToggleAll={() => toggleAllInGroup(items.skills)}
                />
                <ItemGroup
                  label="MCPs"
                  items={items.mcps}
                  excluded={excluded}
                  onToggle={toggleItem}
                  onToggleAll={() => toggleAllInGroup(items.mcps)}
                />
                <ItemGroup
                  label="Plugins"
                  items={items.plugins}
                  excluded={excluded}
                  onToggle={toggleItem}
                  onToggleAll={() => toggleAllInGroup(items.plugins)}
                />
              </div>
            )}
          </div>

          {error && (
            <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
              {error}
            </div>
          )}

          {success && (
            <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs text-emerald-900">
              <div className="font-semibold">Applied successfully.</div>
              {success.backups.length > 0 ? (
                <div className="mt-1 leading-relaxed">
                  Saved a snapshot of each agent's previous state — apply these to revert:
                  <ul className="mt-1 flex flex-col gap-0.5 font-mono text-[11px]">
                    {success.backups.map((b) => (
                      <li key={`${b.agent}-${b.profileName}`}>
                        {b.agent}: {b.profileName}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="mt-1">No prior agent state to back up.</div>
              )}
            </div>
          )}

          <div className="mt-5 flex items-center justify-between gap-3">
            <div className="text-xs text-zinc-500">
              {!success && selectedProfile && allItems.length > 0
                ? `${includedCount} of ${allItems.length} item${allItems.length === 1 ? '' : 's'} → ${agents.size} agent${agents.size === 1 ? '' : 's'}`
                : null}
            </div>
            <div className="flex items-center gap-3">
              {success ? (
                <Dialog.Close asChild>
                  <button
                    type="button"
                    className="inline-flex min-h-[36px] items-center justify-center rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white shadow-sm transition-all hover:bg-zinc-800"
                  >
                    Done
                  </button>
                </Dialog.Close>
              ) : (
                <>
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
                    onClick={() => void apply()}
                    disabled={busy || !selectedProfile}
                    className="inline-flex min-h-[36px] items-center justify-center gap-2 rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white shadow-sm transition-all hover:bg-zinc-800 disabled:opacity-60"
                  >
                    {busy ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Wand2 size={14} />
                    )}
                    {busy ? 'Applying…' : 'Apply'}
                  </button>
                </>
              )}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function itemKey(item: SelectableItem): string {
  return `${item.type}::${item.name}`;
}

function ItemGroup({
  label,
  items,
  excluded,
  onToggle,
  onToggleAll,
}: {
  label: string;
  items: SelectableItem[];
  excluded: Set<string>;
  onToggle: (item: SelectableItem) => void;
  onToggleAll: () => void;
}) {
  if (items.length === 0) return null;
  const allOn = items.every((i) => !excluded.has(itemKey(i)));
  const someOn = items.some((i) => !excluded.has(itemKey(i)));
  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
          {label} ({items.length})
        </span>
        <button
          type="button"
          onClick={onToggleAll}
          className="text-[11px] font-medium text-zinc-500 hover:text-zinc-800"
        >
          {allOn ? 'Deselect all' : someOn ? 'Select all' : 'Select all'}
        </button>
      </div>
      <ul className="mt-1 flex flex-col gap-1">
        {items.map((item) => {
          const k = itemKey(item);
          const checked = !excluded.has(k);
          return (
            <li key={k}>
              <label
                className={`flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 text-sm transition ${
                  checked
                    ? 'border-zinc-200 bg-white text-zinc-800'
                    : 'border-zinc-200 bg-zinc-50 text-zinc-400 line-through'
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle(item)}
                  className="size-3.5 accent-zinc-900"
                />
                <span className="flex-1 truncate font-medium">{item.name}</span>
                {item.agentBadges.length > 0 && (
                  <span className="flex items-center gap-1">
                    {item.agentBadges.map((agent) => (
                      <span
                        key={agent}
                        className="grid size-3.5 place-items-center overflow-hidden"
                        title={agent}
                      >
                        <AgentLogo agent={agent} className="size-full object-contain" />
                      </span>
                    ))}
                  </span>
                )}
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
