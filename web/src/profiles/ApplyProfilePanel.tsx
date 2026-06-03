import { ArrowLeft, Loader2, Wand2 } from 'lucide-react';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { useEffect, useMemo, useState } from 'react';

import { AgentLogo } from '../components/agent-brand';
import { toast } from '../components/ui/toast.js';
import {
  buildProfileApplyItemActions,
  findProfileApplyConflicts,
  profileApplyItemKey,
  type ProfileApplyConflictResolution,
  type ProfileApplySelectableItem,
} from './profile-apply-conflicts.js';
import type { AgentLiveConfig } from './profiles-view.js';

type Agent = 'claude' | 'codex' | 'antigravity';
type ItemType = 'mcp' | 'plugin' | 'skill';

const ALL_AGENTS: Agent[] = ['claude', 'codex', 'antigravity'];

interface ProfileSummary {
  name: string;
  sourceAgent?: Agent;
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

interface SelectableItem extends ProfileApplySelectableItem {
  type: ItemType;
  name: string;
  agentBadges: Agent[];
}

export interface ApplyProfilePanelProps {
  initialProfile: string | null;
  onCancel: () => void;
  onApplied: () => void;
}

export default function ApplyProfilePanel({
  initialProfile,
  onCancel,
  onApplied,
}: ApplyProfilePanelProps) {
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [selectedProfile, setSelectedProfile] = useState<string | null>(initialProfile);
  const [contents, setContents] = useState<ProfileContents | null>(null);
  const [liveConfigs, setLiveConfigs] = useState<AgentLiveConfig[]>([]);
  const [loadingProfiles, setLoadingProfiles] = useState(false);
  const [loadingContents, setLoadingContents] = useState(false);
  const [agents, setAgents] = useState<Set<Agent>>(new Set(ALL_AGENTS));
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [conflictResolutions, setConflictResolutions] = useState<Record<string, ProfileApplyConflictResolution>>({});
  const [promptConflictId, setPromptConflictId] = useState<string | null>(null);
  const [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSelectedProfile(initialProfile);
    setAgents(new Set(ALL_AGENTS));
    setExcluded(new Set());
    setConflictResolutions({});
    setPromptConflictId(null);
    setReplace(false);
    setError(null);
  }, [initialProfile]);

  useEffect(() => {
    let aborted = false;
    setLoadingProfiles(true);
    void (async () => {
      try {
        const r = await fetch('/api/profiles');
        if (!r.ok) {
          const data = (await r.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error ?? `HTTP ${r.status}`);
        }
        const data = (await r.json()) as {
          profiles: Array<string | { name: string; sourceAgent?: Agent }>;
        };
        if (!aborted) {
          setProfiles(
            data.profiles.map((entry) =>
              typeof entry === 'string' ? { name: entry } : entry
            )
          );
        }
      } catch (err) {
        if (!aborted) {
          setProfiles([]);
          setError(err instanceof Error ? err.message : 'Failed to load profiles');
        }
      } finally {
        if (!aborted) setLoadingProfiles(false);
      }
    })();
    return () => {
      aborted = true;
    };
  }, []);

  useEffect(() => {
    let aborted = false;
    void (async () => {
      try {
        const r = await fetch('/api/agents/live');
        if (!r.ok) return;
        const data = (await r.json()) as AgentLiveConfig[];
        if (!aborted) setLiveConfigs(data);
      } catch {
        if (!aborted) setLiveConfigs([]);
      }
    })();
    return () => {
      aborted = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedProfile) {
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
  }, [selectedProfile]);

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

  const allItems = useMemo(
    () => [...items.mcps, ...items.plugins, ...items.skills],
    [items]
  );
  const includedCount = allItems.filter((i) => !excluded.has(itemKey(i))).length;
  const isEmpty = contents !== null && allItems.length === 0;
  const conflicts = useMemo(
    () =>
      findProfileApplyConflicts({
        configs: liveConfigs,
        agents: Array.from(agents),
        items: allItems,
        excludedKeys: excluded,
      }),
    [agents, allItems, excluded, liveConfigs]
  );

  useEffect(() => {
    setConflictResolutions((previous) => {
      const validIds = new Set(conflicts.map((conflict) => conflict.id));
      const next: Record<string, ProfileApplyConflictResolution> = {};
      for (const conflict of conflicts) {
        if (previous[conflict.id]) next[conflict.id] = previous[conflict.id];
      }
      const unchanged =
        Object.keys(previous).length === Object.keys(next).length &&
        Object.keys(previous).every((key) => validIds.has(key) && previous[key] === next[key]);
      return unchanged ? previous : next;
    });
  }, [conflicts]);

  useEffect(() => {
    if (promptConflictId && !conflicts.some((conflict) => conflict.id === promptConflictId)) {
      setPromptConflictId(null);
    }
  }, [conflicts, promptConflictId]);

  const unresolvedConflicts = conflicts.filter((conflict) => !conflictResolutions[conflict.id]);
  const promptConflict = promptConflictId
    ? conflicts.find((conflict) => conflict.id === promptConflictId) ?? null
    : null;
  const promptConflictNumber = promptConflict
    ? conflicts.findIndex((conflict) => conflict.id === promptConflict.id) + 1
    : 0;

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
    setError(null);
    if (unresolvedConflicts.length > 0) {
      setPromptConflictId(unresolvedConflicts[0].id);
      return;
    }
    await submitApply(conflictResolutions);
  }

  async function submitApply(resolutions: Record<string, ProfileApplyConflictResolution>) {
    if (!selectedProfile) return;
    setBusy(true);
    setError(null);
    try {
      const filtered = allItems.filter((i) => !excluded.has(itemKey(i)));
      const itemsPayload =
        filtered.length === allItems.length
          ? undefined
          : filtered.map((i) => ({ type: i.type, name: i.name }));
      const itemActions = buildProfileApplyItemActions(conflicts, resolutions);
      const r = await fetch(
        `/api/profiles/${encodeURIComponent(selectedProfile)}/apply`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            agents: Array.from(agents),
            ...(itemsPayload ? { items: itemsPayload } : {}),
            ...(itemActions.length > 0 ? { itemActions } : {}),
            ...(replace ? { replace: true } : {}),
          }),
        }
      );
      if (!r.ok) {
        const data = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `HTTP ${r.status}`);
      }
      toast.success(`Applied "${selectedProfile}"`);
      onApplied();
      onCancel();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Apply failed');
    } finally {
      setBusy(false);
    }
  }

  function resolvePromptConflict(resolution: ProfileApplyConflictResolution) {
    if (!promptConflict) return;

    const nextResolutions = { ...conflictResolutions, [promptConflict.id]: resolution };
    setConflictResolutions(nextResolutions);

    const nextConflict = conflicts.find((conflict) => !nextResolutions[conflict.id]);
    if (nextConflict) {
      setPromptConflictId(nextConflict.id);
      return;
    }

    setPromptConflictId(null);
    void submitApply(nextResolutions);
  }

  return (
    <>
      <section className="flex h-full min-h-0 flex-col rounded-2xl border border-zinc-200 bg-white shadow-sm">
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-zinc-200 p-5">
        <div className="min-w-0">
          <button
            type="button"
            onClick={onCancel}
            className="mb-3 inline-flex h-7 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2 text-[12px] font-medium text-zinc-600 shadow-sm transition hover:bg-zinc-50 hover:text-zinc-900"
          >
            <ArrowLeft size={13} />
            Local agents
          </button>
          <h3 className="m-0 text-xl font-semibold tracking-tight text-zinc-900">Apply profile</h3>
          <p className="mt-1 max-w-4xl text-[13px] font-medium leading-relaxed text-zinc-500">
            Apply makes each agent match this profile. Before any write, a snapshot of each
            agent's current state is saved as a backup profile so you can revert.
          </p>
        </div>
        <div className="text-right text-xs text-zinc-500">
          {selectedProfile && allItems.length > 0
            ? `${includedCount} of ${allItems.length} item${allItems.length === 1 ? '' : 's'}`
            : null}
        </div>
      </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-hidden p-5 xl:grid-cols-[20rem_minmax(0,1fr)]">
          <aside className="scrollbar-none flex min-h-0 flex-col gap-4 overflow-y-auto pr-1">
          <div className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-zinc-700">Profile</span>
            <select
              className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-400 focus:outline-none disabled:opacity-60"
              value={selectedProfile ?? ''}
              onChange={(e) => setSelectedProfile(e.target.value || null)}
              disabled={busy || loadingProfiles}
            >
              <option value="" disabled>
                {loadingProfiles
                  ? 'Loading profiles...'
                  : profiles.length === 0
                    ? 'No profiles yet'
                    : 'Choose a profile...'}
              </option>
              {profiles.map((profile) => (
                <option key={profile.name} value={profile.name}>
                  {profile.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-zinc-700">Apply to agents</span>
            <div className="grid gap-2">
              {ALL_AGENTS.map((agent) => {
                const checked = agents.has(agent);
                return (
                  <button
                    key={agent}
                    type="button"
                    onClick={() => toggleAgent(agent)}
                    disabled={busy}
                    className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition ${
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

          <div>
            <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
              How to apply
            </div>
            <div className="grid gap-2">
              <button
                type="button"
                onClick={() => setReplace(false)}
                className={`flex flex-col items-start gap-1 rounded-lg border px-3 py-2.5 text-left text-xs transition-all ${
                  !replace
                    ? 'border-zinc-900 bg-zinc-900 text-white shadow-sm'
                    : 'border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300'
                }`}
              >
                <span className="text-sm font-medium">Add to what I have</span>
                <span className={`text-[11px] leading-relaxed ${!replace ? 'text-zinc-300' : 'text-zinc-500'}`}>
                  Existing extra items stay installed.
                </span>
              </button>
              <button
                type="button"
                onClick={() => setReplace(true)}
                className={`flex flex-col items-start gap-1 rounded-lg border px-3 py-2.5 text-left text-xs transition-all ${
                  replace
                    ? 'border-rose-500 bg-rose-50 text-rose-900 shadow-sm'
                    : 'border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300'
                }`}
              >
                <span className="text-sm font-medium">Match this profile exactly</span>
                <span className={`text-[11px] leading-relaxed ${replace ? 'text-rose-700' : 'text-zinc-500'}`}>
                  Items outside this profile will be removed.
                </span>
              </button>
            </div>
          </div>

            {conflicts.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900">
                {unresolvedConflicts.length > 0
                  ? `${unresolvedConflicts.length} conflict${unresolvedConflicts.length === 1 ? '' : 's'} will be reviewed when you apply.`
                  : `${conflicts.length} conflict${conflicts.length === 1 ? '' : 's'} resolved.`}
              </div>
            )}

          {error && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
              {error}
            </div>
          )}
          </aside>

          <div className="flex min-h-0 flex-col rounded-xl border border-zinc-200 bg-zinc-50/40">
          <div className="flex shrink-0 items-center justify-between border-b border-zinc-200 px-4 py-3">
            <div>
              <div className="text-sm font-semibold text-zinc-900">Profile contents</div>
              <div className="text-xs text-zinc-500">Choose exactly what to apply.</div>
            </div>
            <div className="text-xs text-zinc-500">
              {selectedProfile && allItems.length > 0
                ? `${includedCount} selected -> ${agents.size} agent${agents.size === 1 ? '' : 's'}`
                : null}
            </div>
          </div>
          <div className="scrollbar-none min-h-0 flex-1 overflow-y-auto p-4 text-sm">
            {!selectedProfile ? (
              <p className="text-zinc-500">Pick a profile to see its contents.</p>
            ) : loadingContents ? (
              <p className="inline-flex items-center gap-2 text-zinc-500">
                <Loader2 size={14} className="animate-spin" /> Loading...
              </p>
            ) : isEmpty ? (
              <p className="text-zinc-500">This profile has no items to apply.</p>
            ) : (
              <div className="grid gap-4 xl:grid-cols-3">
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
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-zinc-200 p-5">
        <div className="text-xs text-zinc-500">
          {selectedProfile && allItems.length > 0
            ? unresolvedConflicts.length > 0
              ? `${unresolvedConflicts.length} conflict${unresolvedConflicts.length === 1 ? '' : 's'} to review`
              : `${includedCount} of ${allItems.length} item${allItems.length === 1 ? '' : 's'} -> ${agents.size} agent${agents.size === 1 ? '' : 's'}`
            : null}
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="inline-flex min-h-[36px] items-center justify-center rounded-lg border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-700 shadow-sm transition-all hover:bg-zinc-50 hover:text-zinc-900"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void apply()}
            disabled={busy || !selectedProfile}
            className="inline-flex min-h-[36px] items-center justify-center gap-2 rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white shadow-sm transition-all hover:bg-zinc-800 disabled:opacity-60"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
            {busy
              ? 'Applying...'
              : unresolvedConflicts.length > 0
                ? `Resolve ${unresolvedConflicts.length}`
                : 'Apply'}
          </button>
        </div>
      </div>
      </section>

      <AlertDialog.Root
        open={Boolean(promptConflict)}
        onOpenChange={(open) => {
          if (!open) setPromptConflictId(null);
        }}
      >
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
          <AlertDialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-zinc-200/80 bg-white p-6 shadow-xl">
            <AlertDialog.Title className="text-lg font-semibold tracking-tight text-zinc-900">
              {promptConflict?.categoryLabel ?? 'Item'} already exists
            </AlertDialog.Title>
            <AlertDialog.Description className="mt-2 text-sm leading-relaxed text-zinc-500">
              {promptConflict
                ? `${promptConflict.agentLabel} already has "${promptConflict.name}". Choose how to handle this profile item.`
                : ''}
            </AlertDialog.Description>
            {promptConflict && (
              <div className="mt-4 rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-xs font-medium text-zinc-600">
                <div className="mb-1 text-[11px] uppercase tracking-wide text-zinc-400">
                  Conflict {promptConflictNumber} of {conflicts.length}
                </div>
                {promptConflict.canKeepBoth ? (
                  <>
                    Keep both will apply it as{' '}
                    <span className="font-mono text-zinc-900">{promptConflict.suggestedName}</span>.
                  </>
                ) : (
                  'Plugin bundles cannot be duplicated safely because their bundled skills and MCPs keep their original names.'
                )}
              </div>
            )}
            <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
              <AlertDialog.Cancel asChild>
                <button
                  type="button"
                  className="inline-flex min-h-[36px] items-center justify-center rounded-lg border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-700 shadow-sm transition-all hover:bg-zinc-50 hover:text-zinc-900"
                >
                  Cancel
                </button>
              </AlertDialog.Cancel>
              <button
                type="button"
                className="inline-flex min-h-[36px] items-center justify-center rounded-lg border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-700 shadow-sm transition-all hover:bg-zinc-50 hover:text-zinc-900"
                onClick={() => resolvePromptConflict('drop')}
              >
                Drop
              </button>
              {promptConflict?.canKeepBoth && (
                <button
                  type="button"
                  className="inline-flex min-h-[36px] items-center justify-center rounded-lg border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-700 shadow-sm transition-all hover:bg-zinc-50 hover:text-zinc-900"
                  onClick={() => resolvePromptConflict('keep-both')}
                >
                  Keep both
                </button>
              )}
              <button
                type="button"
                className="inline-flex min-h-[36px] items-center justify-center rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white shadow-sm transition-all hover:bg-zinc-800"
                onClick={() => resolvePromptConflict('replace')}
              >
                Replace
              </button>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </>
  );
}

function itemKey(item: ProfileApplySelectableItem): string {
  return profileApplyItemKey(item);
}

function ConflictButton({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`min-h-7 rounded-md border px-1.5 text-[11px] font-medium transition ${
        active
          ? 'border-zinc-900 bg-zinc-900 text-white'
          : 'border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:text-zinc-300'
      }`}
    >
      {children}
    </button>
  );
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
      <div className="sticky top-0 z-10 flex items-center justify-between bg-zinc-50/95 pb-1">
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
