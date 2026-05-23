import {
  ArrowLeft,
  CheckCircle2,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { AgentLogo } from '../components/agent-brand';
import ConfirmDialog from '../components/ConfirmDialog';
import { toast } from '../components/ui/toast.js';

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

interface DraftItem {
  type: ItemType;
  name: string;
  agent?: Agent;
}

type RowState = 'unchanged' | 'added' | 'removed';

function itemKey(item: DraftItem): string {
  if (item.type === 'mcp') return `mcp::${item.name}`;
  return `${item.type}::${item.agent ?? ''}::${item.name}`;
}

export interface EditProfilePanelProps {
  profileName: string;
  onCancel: () => void;
  onChanged: () => void;
}

export default function EditProfilePanel({
  profileName,
  onCancel,
  onChanged,
}: EditProfilePanelProps) {
  const [contents, setContents] = useState<ProfileContents | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [picker, setPicker] = useState<{ type: ItemType } | null>(null);
  const [sourceAgent, setSourceAgent] = useState<Agent | null>(null);
  const [pendingAdds, setPendingAdds] = useState<Map<string, PickerCandidate>>(new Map());
  const [pendingRemoves, setPendingRemoves] = useState<Set<string>>(new Set());
  const [confirmSave, setConfirmSave] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState<null | 'stay' | 'leave'>(null);

  const loadContents = async (): Promise<void> => {
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
    void loadContents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileName]);

  useEffect(() => {
    let aborted = false;
    void (async () => {
      try {
        const r = await fetch('/api/profiles');
        const data = (await r.json()) as {
          profiles: Array<{ name: string; sourceAgent?: Agent }>;
        };
        const me = data.profiles.find((p) => p.name === profileName);
        if (!aborted) setSourceAgent(me?.sourceAgent ?? null);
      } catch {
        // ignore
      }
    })();
    return () => {
      aborted = true;
    };
  }, [profileName]);

  const original = useMemo(() => {
    if (!contents) return { mcps: [], plugins: [], skills: [] };
    return {
      mcps: Object.keys(contents.profile.mcps ?? {}).map(
        (name): DraftItem => ({ type: 'mcp', name })
      ),
      plugins: (contents.manifest?.plugins ?? []).map(
        (p): DraftItem => ({ type: 'plugin', name: p.name, agent: p.agent })
      ),
      skills: (contents.manifest?.userSkills ?? []).map(
        (s): DraftItem => ({ type: 'skill', name: s.name, agent: s.agent })
      ),
    };
  }, [contents]);

  const draft = useMemo(() => {
    const groupOf = (type: ItemType) => {
      const base =
        type === 'mcp' ? original.mcps : type === 'plugin' ? original.plugins : original.skills;
      const rows: Array<DraftItem & { state: RowState; key: string }> = base.map((item) => {
        const key = itemKey(item);
        return { ...item, key, state: pendingRemoves.has(key) ? 'removed' : 'unchanged' };
      });
      for (const cand of pendingAdds.values()) {
        if (cand.type !== type) continue;
        const key = itemKey(cand);
        if (rows.some((r) => r.key === key)) continue;
        rows.push({ ...cand, key, state: 'added' });
      }
      return rows;
    };
    return { mcps: groupOf('mcp'), plugins: groupOf('plugin'), skills: groupOf('skill') };
  }, [original, pendingAdds, pendingRemoves]);

  const counts = useMemo(() => {
    const final = (rows: typeof draft.mcps) => rows.filter((r) => r.state !== 'removed').length;
    return {
      mcps: final(draft.mcps),
      plugins: final(draft.plugins),
      skills: final(draft.skills),
    };
  }, [draft]);

  const totalItems = counts.mcps + counts.plugins + counts.skills;
  const pendingCount = pendingAdds.size + pendingRemoves.size;
  const dirty = pendingCount > 0;

  function existingDraftKeys(type: ItemType): Set<string> {
    const set = new Set<string>();
    const rows =
      type === 'mcp' ? draft.mcps : type === 'plugin' ? draft.plugins : draft.skills;
    for (const r of rows) {
      if (r.state !== 'removed') set.add(r.key);
    }
    return set;
  }

  function stageAdd(candidate: PickerCandidate) {
    const key = itemKey(candidate);
    // If this item was staged for removal, un-stage instead
    if (pendingRemoves.has(key)) {
      const next = new Set(pendingRemoves);
      next.delete(key);
      setPendingRemoves(next);
      return;
    }
    if (existingDraftKeys(candidate.type).has(key)) return; // already there
    const next = new Map(pendingAdds);
    next.set(key, candidate);
    setPendingAdds(next);
  }

  function stageRemove(row: DraftItem & { key: string; state: RowState }) {
    if (row.state === 'added') {
      // un-stage the add
      const next = new Map(pendingAdds);
      next.delete(row.key);
      setPendingAdds(next);
      return;
    }
    const next = new Set(pendingRemoves);
    next.add(row.key);
    setPendingRemoves(next);
  }

  function undoRemove(key: string) {
    const next = new Set(pendingRemoves);
    next.delete(key);
    setPendingRemoves(next);
  }

  function stageRemoveAll(type: ItemType) {
    const rows =
      type === 'mcp' ? draft.mcps : type === 'plugin' ? draft.plugins : draft.skills;
    const nextRemoves = new Set(pendingRemoves);
    const nextAdds = new Map(pendingAdds);
    for (const r of rows) {
      if (r.state === 'added') {
        nextAdds.delete(r.key);
      } else if (r.state === 'unchanged') {
        nextRemoves.add(r.key);
      }
    }
    setPendingAdds(nextAdds);
    setPendingRemoves(nextRemoves);
  }

  function discardAll(thenLeave: boolean) {
    setPendingAdds(new Map());
    setPendingRemoves(new Set());
    setConfirmDiscard(null);
    if (thenLeave) onCancel();
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      for (const key of pendingRemoves) {
        const allRows = [...original.mcps, ...original.plugins, ...original.skills];
        const item = allRows.find((r) => itemKey(r) === key);
        if (!item) continue;
        await deleteProfileItem(profileName, item);
      }
      for (const cand of pendingAdds.values()) {
        const r = await fetch(`/api/profiles/${encodeURIComponent(profileName)}/items`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            type: cand.type,
            agent: cand.agent,
            name: cand.name,
          }),
        });
        if (!r.ok) {
          const data = (await r.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error ?? `HTTP ${r.status}`);
        }
      }
      toast.success(`Saved ${pendingCount} change${pendingCount === 1 ? '' : 's'}`);
      setPendingAdds(new Map());
      setPendingRemoves(new Set());
      setConfirmSave(false);
      await loadContents();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  function handleBack() {
    if (dirty) {
      setConfirmDiscard('leave');
      return;
    }
    onCancel();
  }

  return (
    <section className="relative flex h-full min-h-0 flex-col rounded-2xl border border-zinc-200 bg-white shadow-sm">
      <div className="flex shrink-0 items-start justify-between gap-4 border-b border-zinc-200 p-5">
        <div className="min-w-0">
          <button
            type="button"
            onClick={handleBack}
            className="mb-3 inline-flex h-7 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2 text-[12px] font-medium text-zinc-600 shadow-sm transition hover:bg-zinc-50 hover:text-zinc-900"
          >
            <ArrowLeft size={13} />
            Local agents
          </button>
          <h3 className="m-0 flex items-center gap-2 text-xl font-semibold tracking-tight text-zinc-900">
            {sourceAgent ? (
              <span className="grid size-5 shrink-0 place-items-center overflow-hidden">
                <AgentLogo agent={sourceAgent} className="size-full object-contain" />
              </span>
            ) : null}
            <span className="truncate">{profileName}</span>
          </h3>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-zinc-500">
            <span className="inline-flex items-center gap-1.5 text-zinc-600">
              <Pencil size={12} /> Editing
            </span>
            <span className="text-zinc-300">•</span>
            <span>{totalItems} item{totalItems === 1 ? '' : 's'}</span>
            {dirty && (
              <>
                <span className="text-zinc-300">•</span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 ring-1 ring-amber-200">
                  {pendingAdds.size > 0 && `+${pendingAdds.size}`}
                  {pendingAdds.size > 0 && pendingRemoves.size > 0 && ' / '}
                  {pendingRemoves.size > 0 && `−${pendingRemoves.size}`} unsaved
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="scrollbar-none min-h-0 flex-1 overflow-y-auto p-5">
        {error && (
          <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
            {error}
          </div>
        )}

        {loading || !contents ? (
          <p className="inline-flex items-center gap-2 text-sm text-zinc-500">
            <Loader2 size={14} className="animate-spin" /> Loading…
          </p>
        ) : (
          <div className="grid gap-4 xl:grid-cols-3">
            <Section
              label="Skills"
              rows={draft.skills}
              onAdd={() => {
                setError(null);
                setPicker({ type: 'skill' });
              }}
              onRemoveAll={() => stageRemoveAll('skill')}
              onRemoveOne={stageRemove}
              onUndoRemove={undoRemove}
              empty="No skills in this profile yet."
            />
            <Section
              label="MCPs"
              rows={draft.mcps}
              onAdd={() => {
                setError(null);
                setPicker({ type: 'mcp' });
              }}
              onRemoveAll={() => stageRemoveAll('mcp')}
              onRemoveOne={stageRemove}
              onUndoRemove={undoRemove}
              empty="No MCPs in this profile yet."
            />
            <Section
              label="Plugins"
              rows={draft.plugins}
              onAdd={() => {
                setError(null);
                setPicker({ type: 'plugin' });
              }}
              onRemoveAll={() => stageRemoveAll('plugin')}
              onRemoveOne={stageRemove}
              onUndoRemove={undoRemove}
              empty="No plugins in this profile yet."
            />
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center justify-between gap-3 border-t border-zinc-200 p-5">
        <div className="text-xs text-zinc-500">
          {dirty ? (
            <span>
              {pendingAdds.size > 0 && `${pendingAdds.size} to add`}
              {pendingAdds.size > 0 && pendingRemoves.size > 0 && ' • '}
              {pendingRemoves.size > 0 && `${pendingRemoves.size} to remove`}
            </span>
          ) : (
            <span>No unsaved changes</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setConfirmDiscard('stay')}
            disabled={!dirty || saving}
            className="inline-flex min-h-[36px] items-center justify-center rounded-lg border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-700 shadow-sm transition-all hover:bg-zinc-50 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Discard
          </button>
          <button
            type="button"
            onClick={() => {
              if (pendingRemoves.size > 0) setConfirmSave(true);
              else void save();
            }}
            disabled={!dirty || saving}
            className="inline-flex min-h-[36px] items-center justify-center gap-2 rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white shadow-sm transition-all hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <CheckCircle2 size={14} />
            )}
            {saving ? 'Saving…' : `Save${dirty ? ` ${pendingCount} change${pendingCount === 1 ? '' : 's'}` : ''}`}
          </button>
        </div>
      </div>

      {picker && contents && (
        <AddPicker
          type={picker.type}
          existing={existingDraftKeys(picker.type)}
          onClose={() => setPicker(null)}
          onStage={(c) => {
            stageAdd(c);
          }}
        />
      )}

      <ConfirmDialog
        open={confirmDiscard !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmDiscard(null);
        }}
        title={`Discard ${pendingCount} unsaved change${pendingCount === 1 ? '' : 's'}?`}
        description={
          confirmDiscard === 'leave'
            ? 'Going back will throw away your staged adds and removes. This cannot be undone.'
            : 'Your staged adds and removes will be thrown away. This cannot be undone.'
        }
        confirmLabel={confirmDiscard === 'leave' ? 'Discard and leave' : 'Discard changes'}
        cancelLabel="Keep editing"
        variant="danger"
        onConfirm={() => discardAll(confirmDiscard === 'leave')}
      />

      <ConfirmDialog
        open={confirmSave}
        onOpenChange={setConfirmSave}
        title={`Remove ${pendingRemoves.size} item${pendingRemoves.size === 1 ? '' : 's'} from "${profileName}"?`}
        description={`This profile will lose ${pendingRemoves.size} item${pendingRemoves.size === 1 ? '' : 's'}.${pendingAdds.size > 0 ? ` ${pendingAdds.size} new item${pendingAdds.size === 1 ? '' : 's'} will also be added.` : ''} Live agent configs are not changed.`}
        confirmLabel={saving ? 'Saving…' : 'Save changes'}
        cancelLabel="Cancel"
        variant="danger"
        onConfirm={() => void save()}
      />
    </section>
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
  rows,
  onAdd,
  onRemoveAll,
  onRemoveOne,
  onUndoRemove,
  empty,
}: {
  label: string;
  rows: Array<DraftItem & { state: RowState; key: string }>;
  onAdd: () => void;
  onRemoveAll: () => void;
  onRemoveOne: (row: DraftItem & { state: RowState; key: string }) => void;
  onUndoRemove: (key: string) => void;
  empty: string;
}) {
  const liveCount = rows.filter((r) => r.state !== 'removed').length;
  const removableCount = rows.filter((r) => r.state !== 'removed').length;
  return (
    <section className="flex min-h-0 flex-col rounded-xl border border-zinc-200 bg-zinc-50/40">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-zinc-200 px-3 py-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
          {label} <span className="text-zinc-400">({liveCount})</span>
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onAdd}
            className="inline-flex h-6 items-center gap-1 rounded-md border border-zinc-200 bg-white px-1.5 text-[11px] font-medium text-zinc-700 shadow-sm transition hover:bg-zinc-50"
            title="Add from live agent"
          >
            <Plus size={11} /> Add
          </button>
          <button
            type="button"
            onClick={onRemoveAll}
            disabled={removableCount === 0}
            className="inline-flex h-6 items-center justify-center rounded-md border border-zinc-200 bg-white px-1.5 text-[11px] font-medium text-zinc-500 shadow-sm transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-zinc-200 disabled:hover:bg-white disabled:hover:text-zinc-500"
            title={removableCount === 0 ? `No ${label.toLowerCase()} to remove` : `Stage all ${label.toLowerCase()} for removal`}
          >
            <Trash2 size={11} />
          </button>
        </div>
      </div>
      <div className="scrollbar-none min-h-0 flex-1 overflow-y-auto p-2">
        {rows.length === 0 ? (
          <p className="px-1 py-1 text-xs text-zinc-500">{empty}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {rows.map((row) => (
              <Row
                key={row.key}
                row={row}
                onRemove={() => onRemoveOne(row)}
                onUndoRemove={() => onUndoRemove(row.key)}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function Row({
  row,
  onRemove,
  onUndoRemove,
}: {
  row: DraftItem & { state: RowState; key: string };
  onRemove: () => void;
  onUndoRemove: () => void;
}) {
  const isAdded = row.state === 'added';
  const isRemoved = row.state === 'removed';
  return (
    <li
      className={`flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm transition ${
        isAdded
          ? 'border-emerald-200 bg-emerald-50/60'
          : isRemoved
            ? 'border-rose-200 bg-rose-50/40'
            : 'border-zinc-200 bg-white'
      }`}
    >
      {row.agent && (
        <span className="grid size-4 place-items-center overflow-hidden" title={row.agent}>
          <AgentLogo agent={row.agent} className="size-full object-contain" />
        </span>
      )}
      <span
        className={`flex-1 truncate font-medium ${
          isRemoved ? 'text-rose-700 line-through' : 'text-zinc-800'
        }`}
      >
        {row.name}
      </span>
      {isAdded && (
        <span className="rounded-full bg-emerald-100 px-1.5 py-0 text-[9px] font-semibold uppercase tracking-wide text-emerald-700">
          New
        </span>
      )}
      {isRemoved ? (
        <button
          type="button"
          onClick={onUndoRemove}
          className="inline-flex h-6 items-center gap-1 rounded-md border border-zinc-200 bg-white px-1.5 text-[10px] font-medium text-zinc-600 shadow-sm transition hover:bg-zinc-50"
          title="Undo remove"
        >
          <Undo2 size={11} /> Undo
        </button>
      ) : (
        <button
          type="button"
          onClick={onRemove}
          className="grid size-6 place-items-center rounded text-zinc-500 transition hover:bg-rose-100 hover:text-rose-700"
          title={isAdded ? 'Un-stage this addition' : 'Stage for removal'}
        >
          <X size={12} />
        </button>
      )}
    </li>
  );
}

function AddPicker({
  type,
  existing,
  onClose,
  onStage,
}: {
  type: ItemType;
  existing: Set<string>;
  onClose: () => void;
  onStage: (c: PickerCandidate) => void;
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
            Add {type === 'mcp' ? 'MCP' : type === 'plugin' ? 'plugin' : 'skill'} from a live
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
        <p className="mb-2 text-[11px] text-zinc-500">
          Items are staged locally — click <span className="font-semibold">Save changes</span>{' '}
          on the panel to apply.
        </p>
        {error && (
          <div className="mb-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
            {error}
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
                        return (
                          <li key={k}>
                            <button
                              type="button"
                              onClick={() => onStage(item)}
                              disabled={already}
                              className="flex w-full items-center gap-2 rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-left text-sm text-zinc-800 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <span className="flex-1 truncate font-medium">{item.name}</span>
                              {already ? (
                                <span className="text-[11px] text-zinc-400">
                                  Already in profile
                                </span>
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
