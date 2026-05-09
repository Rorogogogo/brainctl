import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  Loader2,
  PencilLine,
  RefreshCw,
  Settings2,
  Trash2,
  Wand2,
  X,
} from 'lucide-react';

import { AgentLogo } from '../components/agent-brand';
import ConfirmDialog from '../components/ConfirmDialog';
import { Tooltip } from '../components/Tooltip';
import { toast } from '../components/ui/toast.js';
import EditProfileModal from './EditProfileModal';

const AGENTS = ['claude', 'codex', 'gemini'] as const;
type Agent = typeof AGENTS[number];
type ItemType = 'mcp' | 'plugin' | 'skill';

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

interface DrawerItem {
  type: ItemType;
  name: string;
  agent?: Agent; // plugins/skills are agent-scoped
}

interface ApplyState {
  status: 'idle' | 'pending' | 'success' | 'error';
  message?: string;
}
export interface ProfilesDrawerProps {
  onApplyProfile?: (profileName: string) => void;
}

export default function ProfilesDrawer({ onApplyProfile }: ProfilesDrawerProps) {
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [contents, setContents] = useState<Record<string, ProfileContents>>({});
  const [applyState, setApplyState] = useState<Record<string, ApplyState>>({});
  const [loading, setLoading] = useState(true);
  const [refreshState, setRefreshState] = useState<'idle' | 'loading' | 'success'>('idle');
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [renameTarget, setRenameTarget] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [editModalProfile, setEditModalProfile] = useState<string | null>(null);
  const [drawerWidth, setDrawerWidth] = useState<number>(() => {
    if (typeof window === 'undefined') return 224;
    const saved = window.localStorage.getItem('brainctl:profiles-drawer-width');
    const parsed = saved ? Number.parseInt(saved, 10) : NaN;
    return Number.isFinite(parsed) ? clampWidth(parsed) : 224;
  });
  const draggingRef = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      const drag = draggingRef.current;
      if (!drag) return;
      const next = clampWidth(drag.startWidth + (e.clientX - drag.startX));
      setDrawerWidth(next);
    }
    function onUp() {
      if (!draggingRef.current) return;
      draggingRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      try {
        window.localStorage.setItem(
          'brainctl:profiles-drawer-width',
          String(drawerWidth)
        );
      } catch {
        // storage may be unavailable
      }
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [drawerWidth]);

  function startResize(e: ReactMouseEvent): void {
    draggingRef.current = { startX: e.clientX, startWidth: drawerWidth };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  }

  const loadProfiles = useCallback(async () => {
    try {
      const r = await fetch('/api/profiles');
      const data = (await r.json()) as {
        profiles: Array<string | { name: string; sourceAgent?: Agent }>;
      };
      setProfiles(
        data.profiles.map((entry) =>
          typeof entry === 'string' ? { name: entry } : entry
        )
      );
    } catch {
      setProfiles([]);
    }
  }, []);

  const handleRefresh = useCallback(async (options?: { showToast?: boolean }) => {
    setRefreshState('loading');
    try {
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
      if (options?.showToast !== false) {
        toast.success('Profiles refreshed');
      }
      setTimeout(() => setRefreshState('idle'), 1200);
    } catch (err) {
      setRefreshState('idle');
      if (options?.showToast !== false) {
        toast.error(`Failed to refresh profiles: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }, [expanded, loadProfiles]);

  useEffect(() => {
    void (async () => {
      await loadProfiles();
      setLoading(false);
    })();
  }, [loadProfiles]);

  useEffect(() => {
    const onChanged = () => void handleRefresh({ showToast: false });
    window.addEventListener('brainctl:profiles-changed', onChanged);
    return () => window.removeEventListener('brainctl:profiles-changed', onChanged);
  }, [handleRefresh]);

  async function commitRename() {
    if (!renameTarget) return;
    const newName = renameValue.trim();
    if (newName.length === 0 || newName === renameTarget) {
      setRenameTarget(null);
      setRenameValue('');
      return;
    }
    setRenaming(true);
    try {
      const r = await fetch(`/api/profiles/${encodeURIComponent(renameTarget)}/rename`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ newName }),
      });
      if (!r.ok) {
        const data = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `HTTP ${r.status}`);
      }
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.delete(renameTarget)) next.add(newName);
        return next;
      });
      setContents((prev) => {
        if (!(renameTarget in prev)) return prev;
        const { [renameTarget]: moved, ...rest } = prev;
        return moved ? { ...rest, [newName]: moved } : rest;
      });
      window.dispatchEvent(new CustomEvent('brainctl:profiles-changed'));
      await loadProfiles();
      setRenameTarget(null);
      setRenameValue('');
    } catch (err) {
      window.alert(`Rename failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRenaming(false);
    }
  }

  async function deleteProfile(profileName: string) {
    setDeleting(true);
    try {
      const r = await fetch(`/api/profiles/${encodeURIComponent(profileName)}`, {
        method: 'DELETE',
      });
      if (!r.ok) {
        const data = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `HTTP ${r.status}`);
      }
      setExpanded((prev) => {
        const next = new Set(prev);
        next.delete(profileName);
        return next;
      });
      setContents((prev) => {
        const next = { ...prev };
        delete next[profileName];
        return next;
      });
      window.dispatchEvent(new CustomEvent('brainctl:profiles-changed'));
      await loadProfiles();
    } catch (err) {
      window.alert(`Delete failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  }

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
      <aside
        className="relative flex h-full min-h-0 shrink-0 flex-col gap-2 border-r border-zinc-200 bg-[#fcfcfc] p-2 text-xs"
        style={{ width: drawerWidth }}
      >
        <Loader2 className="size-4 animate-spin text-zinc-400" />
        <ResizeHandle onMouseDown={startResize} />
      </aside>
    );
  }

  return (
    <aside
      className="relative flex h-full min-h-0 shrink-0 flex-col gap-2 border-r border-zinc-200 bg-[#fcfcfc] p-2 text-xs"
      style={{ width: drawerWidth }}
    >
      <div className="flex items-center justify-between px-1">
        <h2 className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
          Profiles
        </h2>
        <Tooltip label="Reload profiles list">
        <button
          type="button"
          onClick={() => void handleRefresh()}
          disabled={refreshState === 'loading'}
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
        </Tooltip>
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
      <ul className="min-h-0 flex-1 overflow-y-auto pr-1 flex flex-col gap-1">
        {profiles.map((p) => (
          <li key={p.name} className="rounded-lg border border-zinc-200 bg-zinc-50">
            <div className="flex items-center gap-1 px-1 py-1">
              {renameTarget === p.name ? (
                <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-0.5">
                  <Folder size={12} className="text-zinc-500 shrink-0" />
                  <input
                    autoFocus
                    type="text"
                    value={renameValue}
                    disabled={renaming}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void commitRename();
                      else if (e.key === 'Escape') {
                        setRenameTarget(null);
                        setRenameValue('');
                      }
                    }}
                    onBlur={() => void commitRename()}
                    className="min-w-0 flex-1 rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-xs font-medium text-zinc-800 outline-none focus:border-zinc-500 disabled:opacity-50"
                  />
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => void toggle(p.name)}
                  title={p.name}
                  className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-0.5 text-left font-medium text-zinc-800 hover:bg-zinc-100"
                >
                  {expanded.has(p.name) ? (
                    <ChevronDown size={12} />
                  ) : (
                    <ChevronRight size={12} />
                  )}
                  {p.sourceAgent ? (
                    <span
                      className="grid size-3.5 shrink-0 place-items-center overflow-hidden"
                      title={`Snapshot of ${p.sourceAgent}`}
                    >
                      <AgentLogo agent={p.sourceAgent} className="size-full object-contain" />
                    </span>
                  ) : (
                    <Folder size={12} className="text-zinc-500" />
                  )}
                  <span className="truncate">{p.name}</span>
                </button>
              )}
              {renameTarget !== p.name && (
                <Tooltip label="Apply profile…">
                <button
                  type="button"
                  onClick={() => {
                    onApplyProfile?.(p.name);
                  }}
                  disabled={deleting || renaming}
                  className="grid size-5 place-items-center rounded text-zinc-500 transition hover:bg-emerald-100 hover:text-emerald-700 disabled:opacity-50"
                >
                  <Wand2 size={11} />
                </button>
                </Tooltip>
              )}
              {renameTarget !== p.name && (
                <Tooltip label="Edit profile contents…">
                <button
                  type="button"
                  onClick={() => setEditModalProfile(p.name)}
                  disabled={deleting || renaming}
                  className="grid size-5 place-items-center rounded text-zinc-500 transition hover:bg-zinc-100 disabled:opacity-50"
                >
                  <Settings2 size={11} />
                </button>
                </Tooltip>
              )}
              {renameTarget === p.name ? (
                <Tooltip label="Cancel rename">
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setRenameTarget(null);
                    setRenameValue('');
                  }}
                  disabled={renaming}
                  className="grid size-5 place-items-center rounded text-zinc-500 transition hover:bg-zinc-100 disabled:opacity-50"
                >
                  <X size={11} />
                </button>
                </Tooltip>
              ) : (
                <Tooltip label="Rename profile">
                <button
                  type="button"
                  onClick={() => {
                    setRenameTarget(p.name);
                    setRenameValue(p.name);
                  }}
                  disabled={renaming || deleting}
                  className="grid size-5 place-items-center rounded text-zinc-500 transition hover:bg-zinc-100 disabled:opacity-50"
                >
                  <PencilLine size={11} />
                </button>
                </Tooltip>
              )}
              <Tooltip label="Open profile folder in Finder">
              <button
                type="button"
                onClick={() => void openFolder(p.name)}
                className="grid size-5 place-items-center rounded text-zinc-500 transition hover:bg-zinc-100"
              >
                <FolderOpen size={11} />
              </button>
              </Tooltip>
              <Tooltip label="Delete profile">
              <button
                type="button"
                onClick={() => setDeleteTarget(p.name)}
                disabled={deleting}
                className="grid size-5 place-items-center rounded text-zinc-500 transition hover:bg-rose-100 hover:text-rose-700 disabled:opacity-50"
              >
                <Trash2 size={11} />
              </button>
              </Tooltip>
            </div>
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
      <EditProfileModal
        open={editModalProfile !== null}
        onOpenChange={(open) => {
          if (!open) setEditModalProfile(null);
        }}
        profileName={editModalProfile}
        onChanged={() => {
          window.dispatchEvent(new CustomEvent('brainctl:profiles-changed'));
        }}
      />
      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title={`Delete profile "${deleteTarget ?? ''}"?`}
        description="This removes the profile folder and all bundled plugins/skills. Live agent configs are not changed."
        confirmLabel={deleting ? 'Deleting...' : 'Delete'}
        cancelLabel="Cancel"
        variant="danger"
        onConfirm={() => {
          if (deleteTarget) void deleteProfile(deleteTarget);
        }}
      />
      <ResizeHandle onMouseDown={startResize} />
    </aside>
  );
}

const MIN_DRAWER_WIDTH = 180;
const MAX_DRAWER_WIDTH = 520;

function clampWidth(value: number): number {
  if (!Number.isFinite(value)) return 224;
  return Math.max(MIN_DRAWER_WIDTH, Math.min(MAX_DRAWER_WIDTH, Math.round(value)));
}

function ResizeHandle({
  onMouseDown,
}: {
  onMouseDown: (event: ReactMouseEvent) => void;
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      onMouseDown={onMouseDown}
      className="group absolute right-0 top-0 z-10 h-full w-1.5 -mr-0.5 cursor-col-resize"
      title="Drag to resize"
    >
      <div className="absolute inset-y-0 right-0 w-px bg-transparent transition-colors group-hover:bg-zinc-300" />
    </div>
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
      {skills.length > 0 && (
        <Group label="Skills">
          {dedupeByName(skills).map((s) => (
            <Item
              key={`skill-${s.name}`}
              label={s.name}
              applyState={applyState}
              applyKeyPrefix={`${profileName}::skill:${s.name}`}
              onApply={(agent) =>
                onApply(profileName, { type: 'skill', name: s.name, agent }, agent)
              }
              dragPayload={{ profileName, type: 'skill', name: s.name }}
            />
          ))}
        </Group>
      )}
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
              onApply={(agent) =>
                onApply(profileName, { type: 'plugin', name: p.name, agent: p.agent }, agent)
              }
              dragPayload={{ profileName, type: 'plugin', name: p.name, agent: p.agent }}
            />
          ))}
        </Group>
      )}
    </div>
  );
}

function dedupeByName<T extends { name: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    if (seen.has(item.name)) continue;
    seen.add(item.name);
    out.push(item);
  }
  return out;
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
  const [armedAgent, setArmedAgent] = useState<Agent | null>(null);
  const armedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const arm = (agent: Agent) => {
    setArmedAgent(agent);
    if (armedTimer.current) clearTimeout(armedTimer.current);
    armedTimer.current = setTimeout(() => setArmedAgent(null), 3000);
  };

  const fire = (agent: Agent) => {
    if (armedTimer.current) clearTimeout(armedTimer.current);
    armedTimer.current = null;
    setArmedAgent(null);
    void onApply(agent);
  };

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
          const armed = armedAgent === agent;
          return (
            <Tooltip
              key={agent}
              label={
                armed
                  ? `Click again to apply to ${agent}`
                  : state?.message
                    ? `${agent}: ${state.message}`
                    : `Apply to ${agent} (overwrites live config)`
              }
            >
              <button
                type="button"
                onClick={() => (armed ? fire(agent) : arm(agent))}
                disabled={status === 'pending'}
                className={`grid size-5 place-items-center rounded transition ${
                  armed
                    ? 'bg-amber-200 ring-1 ring-amber-400'
                    : status === 'success'
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
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}
