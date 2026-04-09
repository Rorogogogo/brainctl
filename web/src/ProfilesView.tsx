import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  type Modifier,
} from '@dnd-kit/core';
import {
  ArrowRightLeft,
  Boxes,
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  Loader2,
  PencilLine,
  Plus,
  RefreshCw,
  Save,
  Server,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import {
  applyPendingChangesWithApi,
  canStagePendingAddition,
  formatPluginSubtitle,
  splitAgentSkillEntries,
  type AgentLiveConfig,
  type AgentMcpEntry,
  type AgentSkillEntry,
  type PendingChange,
} from './profiles-view';
import { AgentLogo } from './agent-brand';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type FeedbackState = { type: 'success' | 'error'; message: string } | null;

interface McpPreflightResult {
  ok: boolean;
  checks: Array<{
    label: string;
    status: 'ok' | 'warn' | 'error';
    message: string;
  }>;
}

interface SkillPreflightResult {
  ok: boolean;
  checks: Array<{
    label: string;
    status: 'ok' | 'warn' | 'error';
    message: string;
  }>;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

function parseDragId(id: string): { agent: string; category: 'mcp' | 'skill' | 'plugin'; key: string } | null {
  const parts = id.split(':');
  if (parts.length < 3) return null;
  const category = parts[1] as 'mcp' | 'skill' | 'plugin';
  if (category !== 'mcp' && category !== 'skill' && category !== 'plugin') return null;
  return { agent: parts[0], category, key: parts.slice(2).join(':') };
}

function parseDropId(id: string): { agent: string; category: 'mcp' | 'skill' | 'plugin' } | null {
  const m = id.match(/^(\w+):(mcps|skills|plugins)$/);
  if (!m) return null;
  return {
    agent: m[1],
    category: m[2] === 'mcps' ? 'mcp' : m[2] === 'skills' ? 'skill' : 'plugin',
  };
}

const AGENT_LABELS: Record<string, string> = {
  claude: 'Claude',
  codex: 'Codex',
  gemini: 'Gemini',
};

/** Snap the drag overlay so its top-left follows the pointer */
const snapToPointer: Modifier = ({ activatorEvent, draggingNodeRect, transform }) => {
  if (activatorEvent && draggingNodeRect) {
    const event = activatorEvent as PointerEvent;
    const offsetX = event.clientX - draggingNodeRect.left;
    const offsetY = event.clientY - draggingNodeRect.top;
    return {
      ...transform,
      x: transform.x + offsetX - 20,
      y: transform.y + offsetY - 20,
    };
  }
  return transform;
};

let changeIdCounter = 0;
function nextChangeId(): string {
  return `change-${++changeIdCounter}`;
}

function applyPendingChanges(
  configs: AgentLiveConfig[],
  changes: PendingChange[]
): AgentLiveConfig[] {
  const result: AgentLiveConfig[] = configs.map((c) => ({
    ...c,
    mcpServers: { ...c.mcpServers },
    skills: [...c.skills],
  }));
  for (const change of changes) {
    const config = result.find((c) => c.agent === change.agent);
    if (!config) continue;
    if (change.category === 'mcp') {
      if (change.type === 'add' && change.entry) {
        config.mcpServers[change.key] = change.entry;
      } else if (change.type === 'remove') {
        delete config.mcpServers[change.key];
      }
    } else if (change.category === 'skill') {
      if (change.type === 'add' && change.skillEntry) {
        if (!config.skills.some((s) => s.name === change.key)) {
          config.skills = [...config.skills, change.skillEntry];
        }
      } else if (change.type === 'remove') {
        config.skills = config.skills.filter((s) => s.name !== change.key);
      }
    } else if (change.category === 'plugin') {
      if (change.type === 'add' && change.pluginEntry) {
        if (!config.skills.some((s) => s.name === change.key && s.kind === 'plugin')) {
          config.skills = [...config.skills, change.pluginEntry];
        }
      } else if (change.type === 'remove') {
        config.skills = config.skills.filter((s) => !(s.name === change.key && s.kind === 'plugin'));
      }
    }
  }
  return result;
}

function getPendingKeys(changes: PendingChange[]): {
  added: Map<string, Set<string>>;
  removed: Map<string, Set<string>>;
  skillAdded: Map<string, Set<string>>;
  skillRemoved: Map<string, Set<string>>;
  pluginAdded: Map<string, Set<string>>;
  pluginRemoved: Map<string, Set<string>>;
} {
  const added = new Map<string, Set<string>>();
  const removed = new Map<string, Set<string>>();
  const skillAdded = new Map<string, Set<string>>();
  const skillRemoved = new Map<string, Set<string>>();
  const pluginAdded = new Map<string, Set<string>>();
  const pluginRemoved = new Map<string, Set<string>>();
  for (const change of changes) {
    if (change.category === 'plugin') {
      const map = change.type === 'add' ? pluginAdded : pluginRemoved;
      if (!map.has(change.agent)) map.set(change.agent, new Set());
      map.get(change.agent)!.add(change.key);
      continue;
    }
    const isSkill = change.category === 'skill';
    const map = change.type === 'add'
      ? (isSkill ? skillAdded : added)
      : (isSkill ? skillRemoved : removed);
    if (!map.has(change.agent)) map.set(change.agent, new Set());
    map.get(change.agent)!.add(change.key);
  }
  return { added, removed, skillAdded, skillRemoved, pluginAdded, pluginRemoved };
}

/* ------------------------------------------------------------------ */
/*  DnD primitives                                                     */
/* ------------------------------------------------------------------ */

function DraggableCard({
  id,
  label,
  sublabel,
  icon,
  status,
  onRemove,
  editable,
}: {
  id: string;
  label: string;
  sublabel: string;
  icon?: ReactNode;
  status?: 'added' | 'removed';
  onRemove?: () => void;
  editable: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } =
    useDraggable({ id, disabled: !editable });

  const statusClass =
    status === 'added'
      ? ' border-emerald-200/80 bg-emerald-50/50'
      : status === 'removed'
      ? ' border-red-200/80 bg-red-50/50 opacity-75 line-through'
      : ' border-zinc-200/80 bg-white';
      
  const editableClass = editable
    ? ' cursor-grab hover:border-zinc-400 hover:shadow-md active:cursor-grabbing'
    : '';

  const dragProps = editable ? { ...listeners, ...attributes } : {};

  return (
    <div
      ref={setNodeRef}
      className={`flex items-start gap-2 rounded-xl border p-2.5 shadow-sm transition-all ${isDragging ? 'opacity-45' : ''}${statusClass}${editableClass}`}
      {...dragProps}
    >
      <div className="flex w-full items-start gap-2">
        {icon ? <span className="grid size-6 shrink-0 place-items-center rounded-lg border border-zinc-200/80 bg-white text-zinc-900 shadow-sm">{icon}</span> : null}
        <div className="grid min-w-0 flex-1 gap-0.5">
          <strong className="truncate text-[13px] font-semibold text-zinc-900">{label}</strong>
          <span className="truncate text-[11px] text-zinc-500">{sublabel}</span>
        </div>
        {status && (
          <span className={`inline-flex shrink-0 items-center justify-center rounded-[6px] px-1.5 py-0.5 text-[11px] font-bold leading-none ${status === 'added' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
            {status === 'added' ? '+' : '-'}
          </span>
        )}
        {onRemove && !status && (
          <button
            className="grid size-6 shrink-0 place-items-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={onRemove}
            title={`Stage removal of ${label}`}
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>
    </div>
  );
}

function OverlayCard({ label, sublabel }: { label: string; sublabel: string }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-zinc-300 bg-white p-2.5 shadow-2xl shadow-zinc-900/10">
      <div className="flex w-full items-start gap-2">
        <span className="grid size-6 shrink-0 place-items-center rounded-lg border border-zinc-200/80 bg-white text-zinc-900 shadow-sm">
          <ArrowRightLeft size={14} />
        </span>
        <div className="grid min-w-0 flex-1 gap-0.5">
          <strong className="truncate text-[13px] font-semibold text-zinc-900">{label}</strong>
          <span className="truncate text-[11px] text-zinc-500">{sublabel}</span>
        </div>
      </div>
    </div>
  );
}

function StaticCard({
  id,
  label,
  sublabel,
  details,
  status,
  onRemove,
  editable,
}: {
  id: string;
  label: string;
  sublabel: string;
  details?: string[];
  status?: 'added' | 'removed';
  onRemove?: () => void;
  editable: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id, disabled: !editable });
  const [expanded, setExpanded] = useState(false);
  
  const statusClass =
    status === 'added'
      ? ' border-emerald-200/80 bg-emerald-50/50'
      : status === 'removed'
      ? ' border-red-200/80 bg-red-50/50 opacity-75 line-through'
      : ' border-zinc-200/80 bg-white';
      
  const editableClass = editable
    ? ' cursor-grab hover:border-zinc-400 hover:shadow-md active:cursor-grabbing'
    : '';

  const skillCount = details?.length ?? 0;
  const hasDetails = skillCount > 0;
  const dragProps = editable ? { ...listeners, ...attributes } : {};

  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col items-start gap-1 rounded-xl border p-2.5 shadow-sm transition-all ${isDragging ? 'opacity-45' : ''}${statusClass}${editableClass}`}
      {...dragProps}
    >
      <div className="flex w-full items-start gap-2">
        <div className="grid min-w-0 flex-1 gap-0.5">
          <strong className="truncate text-[13px] font-semibold text-zinc-900">{label}</strong>
          <span className="truncate text-[11px] text-zinc-500">{sublabel}</span>
        </div>
        {status ? (
          <span className={`inline-flex shrink-0 items-center justify-center rounded-[6px] px-1.5 py-0.5 text-[11px] font-bold leading-none ${status === 'added' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
            {status === 'added' ? '+' : '-'}
          </span>
        ) : (
          <span className="inline-flex shrink-0 items-center justify-center rounded-[6px] bg-zinc-100 px-1.5 py-0.5 text-[11px] font-bold leading-none text-zinc-500">plugin</span>
        )}
        {hasDetails ? (
          <button
            className="grid size-6 shrink-0 place-items-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => setExpanded((value) => !value)}
            title={expanded ? `Collapse ${label}` : `Expand ${label}`}
            aria-expanded={expanded}
          >
            {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </button>
        ) : null}
        {onRemove && !status ? (
          <button
            className="grid size-6 shrink-0 place-items-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={onRemove}
            title={`Stage removal of ${label}`}
          >
            <Trash2 size={13} />
          </button>
        ) : null}
      </div>
      {hasDetails && expanded ? (
        <div className="pl-1 pt-1">
          <span className="text-[11px] leading-relaxed text-zinc-500">
            {details!.join(', ')}
          </span>
        </div>
      ) : null}
    </div>
  );
}

function DroppableZone({
  id,
  label,
  icon,
  count,
  children,
}: {
  id: string;
  label: string;
  icon: ReactNode;
  count: number;
  children: ReactNode;
}) {
  const { isOver, setNodeRef } = useDroppable({ id });

  return (
    <div
      ref={setNodeRef}
      className={`grid min-h-[88px] gap-2 rounded-xl p-2 transition-all ${isOver ? 'bg-slate-50 shadow-inner ring-1 ring-zinc-200' : 'bg-transparent'}`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="grid size-6 shrink-0 place-items-center rounded-lg border border-zinc-200/80 bg-white text-zinc-900 shadow-sm">{icon}</span>
          <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 m-0">{label}</p>
        </div>
        <span className="inline-flex min-w-[32px] items-center justify-center rounded-full border border-zinc-200/80 bg-white px-2 py-0.5 text-[11px] font-bold text-zinc-900 shadow-sm">{count}</span>
      </div>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  AgentColumn — shows MCPs + Skills from live config                 */
/* ------------------------------------------------------------------ */

function AgentColumn({
  config,
  pendingAdded,
  pendingRemoved,
  pendingSkillAdded,
  pendingSkillRemoved,
  pendingPluginAdded,
  pendingPluginRemoved,
  onStagedRemove,
  editable,
}: {
  config: AgentLiveConfig;
  pendingAdded: Set<string>;
  pendingRemoved: Set<string>;
  pendingSkillAdded: Set<string>;
  pendingSkillRemoved: Set<string>;
  pendingPluginAdded: Set<string>;
  pendingPluginRemoved: Set<string>;
  onStagedRemove: (agent: string, category: 'mcp' | 'skill' | 'plugin', key: string) => void;
  editable: boolean;
}) {
  const mcpEntries = Object.entries(config.mcpServers);
  const { skills: localSkills, plugins } = splitAgentSkillEntries(config.skills);

  return (
    <div className={`flex flex-col gap-4 rounded-2xl border border-zinc-200/80 bg-white p-5 shadow-sm profile-column-${config.agent}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl border border-zinc-200/80 bg-gradient-to-b from-white to-zinc-50 text-sm font-bold shadow-sm">
            <AgentLogo agent={config.agent} className="size-5 overflow-hidden" />
          </span>
          <div className="space-y-0.5 overflow-hidden">
            <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 m-0">{AGENT_LABELS[config.agent] ?? config.agent}</p>
            <p className="font-mono text-[11px] text-zinc-500 m-0 break-all">{config.configPath}</p>
          </div>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border border-zinc-200/80 px-2.5 py-1 text-[11px] font-semibold shadow-sm ${config.exists ? 'bg-zinc-900 text-white border-zinc-900' : 'bg-white text-zinc-500'}`}
        >
          {config.exists ? 'Found' : 'No config'}
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200/80 bg-white px-2.5 py-1 text-[11px] font-semibold text-zinc-500 shadow-sm">
          <Server size={12} /> {mcpEntries.length} MCPs
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200/80 bg-white px-2.5 py-1 text-[11px] font-semibold text-zinc-500 shadow-sm">
          <FileText size={12} /> {localSkills.length} Skills
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200/80 bg-white px-2.5 py-1 text-[11px] font-semibold text-zinc-500 shadow-sm">
          <Boxes size={12} /> {plugins.length} Plugins
        </span>
      </div>

      {/* MCP Servers */}
      <DroppableZone
        id={`${config.agent}:mcps`}
        label="MCP Servers"
        icon={<Server size={14} />}
        count={mcpEntries.length}
      >
        {mcpEntries.map(([key, entry]) => {
          const sublabel =
            entry.args && entry.args.length > 0
              ? `${entry.command} ${entry.args.join(' ')}`
              : entry.command;

          const status = pendingAdded.has(key)
            ? ('added' as const)
            : pendingRemoved.has(key)
            ? ('removed' as const)
            : undefined;

          return (
            <DraggableCard
              key={key}
              id={`${config.agent}:mcp:${key}`}
              label={key}
              sublabel={sublabel}
              icon={<Server size={14} />}
              status={status}
              onRemove={editable ? () => onStagedRemove(config.agent, 'mcp', key) : undefined}
              editable={editable}
            />
          );
        })}
        {mcpEntries.length === 0 && (
          <p className="text-sm text-zinc-500 m-0">No MCPs configured.</p>
        )}
      </DroppableZone>

      {/* Skills */}
      <DroppableZone
        id={`${config.agent}:skills`}
        label="Skills"
        icon={<FileText size={14} />}
        count={localSkills.length}
      >
        {localSkills.map((skill) => {
          const status = pendingSkillAdded.has(skill.name)
            ? ('added' as const)
            : pendingSkillRemoved.has(skill.name)
            ? ('removed' as const)
            : undefined;

          return (
            <DraggableCard
              key={skill.name}
              id={`${config.agent}:skill:${skill.name}`}
              label={skill.name}
              sublabel={skill.source ?? 'local'}
              icon={<FileText size={14} />}
              status={status}
              onRemove={editable ? () => onStagedRemove(config.agent, 'skill', skill.name) : undefined}
              editable={editable}
            />
          );
        })}
        {localSkills.length === 0 && (
          <p className="text-sm text-zinc-500 m-0">No skills installed.</p>
        )}
      </DroppableZone>

      <DroppableZone
        id={`${config.agent}:plugins`}
        label="Plugins"
        icon={<Boxes size={14} />}
        count={plugins.length}
      >
        {plugins.map((plugin) => {
          const status = pendingPluginAdded.has(plugin.name)
            ? ('added' as const)
            : pendingPluginRemoved.has(plugin.name)
            ? ('removed' as const)
            : undefined;

          return (
            <StaticCard
              key={plugin.name}
              id={`${config.agent}:plugin:${plugin.name}`}
              label={plugin.name}
              sublabel={formatPluginSubtitle(plugin)}
              details={plugin.pluginSkills}
              status={status}
              onRemove={editable && plugin.managed ? () => onStagedRemove(config.agent, 'plugin', plugin.name) : undefined}
              editable={editable}
            />
          );
        })}
        {plugins.length === 0 && (
          <p className="text-sm text-zinc-500 m-0">No plugins discovered.</p>
        )}
      </DroppableZone>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  PendingChangesBar                                                   */
/* ------------------------------------------------------------------ */

function PendingChangesBar({
  changes,
  onUndoChange,
  onDiscardAll,
  onSave,
  saving,
}: {
  changes: PendingChange[];
  onUndoChange: (id: string) => void;
  onDiscardAll: () => void;
  onSave: () => void;
  saving: boolean;
}) {
  if (changes.length === 0) return null;

  return (
    <div className="sticky top-3 z-10 grid gap-3 rounded-2xl border border-zinc-200/80 bg-white p-5 shadow-xl shadow-zinc-200/40">
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 m-0">
          {changes.length} pending change{changes.length > 1 ? 's' : ''}
        </p>
        <div className="flex flex-wrap gap-2">
          <button className="inline-flex min-h-[36px] items-center gap-2 rounded-lg border border-zinc-200/80 bg-white px-3.5 text-sm font-medium text-zinc-600 shadow-sm transition-all hover:bg-zinc-50 hover:text-zinc-900 disabled:opacity-50" onClick={onDiscardAll} disabled={saving}>
            <Undo2 size={14} /> Discard all
          </button>
          <button className="inline-flex min-h-[36px] items-center gap-2 rounded-lg border border-zinc-900 bg-zinc-900 px-3.5 text-sm font-medium text-white shadow-md transition-all hover:bg-zinc-800 disabled:opacity-50" onClick={onSave} disabled={saving}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}{' '}
            Save & apply
          </button>
        </div>
      </div>
      <div className="grid gap-2">
        {changes.map((change) => (
          <div
            key={change.id}
            className={`flex items-center gap-3 rounded-xl border p-3 text-[13px] ${change.type === 'add' ? 'border-emerald-200/80 bg-emerald-50/50' : 'border-red-200/80 bg-red-50/50'}`}
          >
            <span className={`grid place-items-center shrink-0 ${change.type === 'add' ? 'text-emerald-600' : 'text-red-600'}`}>
              {change.type === 'add' ? <Plus size={14} /> : <X size={14} />}
            </span>
            <span className="flex-1 min-w-0 truncate">
              <strong className="font-semibold text-zinc-900">[{change.category}] {change.key}</strong>
              {change.type === 'add' ? (
                <>
                  {' '}&rarr; {AGENT_LABELS[change.agent]}
                  {change.sourceAgent ? ` (from ${AGENT_LABELS[change.sourceAgent]})` : ''}
                </>
              ) : (
                <> removed from {AGENT_LABELS[change.agent]}</>
              )}
            </span>
            <button
              className="grid size-[26px] shrink-0 place-items-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
              onClick={() => onUndoChange(change.id)}
              title="Undo this change"
              disabled={saving}
            >
              <Undo2 size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  ProfilesView (root)                                                */
/* ------------------------------------------------------------------ */

export default function ProfilesView() {
  const [agentConfigs, setAgentConfigs] = useState<AgentLiveConfig[]>([]);
  const [pendingChanges, setPendingChanges] = useState<PendingChange[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout>>();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const showFeedback = useCallback(
    (type: 'success' | 'error', message: string) => {
      setFeedback({ type, message });
      clearTimeout(feedbackTimer.current);
      feedbackTimer.current = setTimeout(() => setFeedback(null), 4000);
    },
    []
  );

  const fetchLiveConfigs = useCallback(async () => {
    try {
      const configs = await fetchJson<AgentLiveConfig[]>('/api/agents/live');
      setAgentConfigs(configs);
    } catch (err) {
      showFeedback('error', `Failed to load agent configs: ${(err as Error).message}`);
    }
  }, [showFeedback]);

  useEffect(() => {
    (async () => {
      await fetchLiveConfigs();
      setLoading(false);
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const previewConfigs = applyPendingChanges(agentConfigs, pendingChanges);
  const {
    added: pendingAddedMap,
    removed: pendingRemovedMap,
    skillAdded: pendingSkillAddedMap,
    skillRemoved: pendingSkillRemovedMap,
    pluginAdded: pendingPluginAddedMap,
    pluginRemoved: pendingPluginRemovedMap,
  } =
    getPendingKeys(pendingChanges);

  const handleStagedRemove = useCallback(
    (agent: string, category: 'mcp' | 'skill' | 'plugin', key: string) => {
      const alreadyStaged = pendingChanges.some(
        (c) => c.agent === agent && c.category === category && c.key === key
      );
      if (alreadyStaged) return;
      setPendingChanges((prev) => [
        ...prev,
        { id: nextChangeId(), type: 'remove', category, agent, key },
      ]);
    },
    [pendingChanges]
  );

  const handleUndoChange = useCallback((id: string) => {
    setPendingChanges((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const handleDiscardAll = useCallback(() => {
    setPendingChanges([]);
  }, []);

  const handleSave = useCallback(async () => {
    if (pendingChanges.length === 0) return;

    const changeCount = pendingChanges.length;
    const summary = pendingChanges
      .map((c) => {
      const prefix = c.category === 'skill' ? '[skill] ' : '[mcp] ';
      if (c.category === 'plugin') {
        return c.type === 'add'
          ? `+ [plugin] ${c.key} -> ${AGENT_LABELS[c.agent]}`
          : `- [plugin] ${c.key} from ${AGENT_LABELS[c.agent]} (removes bundled skills and MCPs)`;
      }
      return c.type === 'add'
          ? `+ ${prefix}${c.key} -> ${AGENT_LABELS[c.agent]}`
          : `- ${prefix}${c.key} from ${AGENT_LABELS[c.agent]}`;
      })
      .join('\n');

    const confirmed = window.confirm(
      `Apply ${changeCount} change${changeCount > 1 ? 's' : ''} to agent configs?\n\n${summary}`
    );
    if (!confirmed) return;

    setSaving(true);
    try {
      const result = await applyPendingChangesWithApi(pendingChanges, async (change) => {
        if (change.category === 'mcp') {
          if (change.type === 'add' && change.entry) {
            await fetchJson(`/api/agents/${change.agent}/mcps`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ key: change.key, entry: change.entry }),
            });
          } else if (change.type === 'remove') {
            await fetchJson(
              `/api/agents/${change.agent}/mcps/${encodeURIComponent(change.key)}`,
              { method: 'DELETE' }
            );
          } else {
            throw new Error(`MCP "${change.key}" is missing the staged metadata needed to apply this change.`);
          }
        } else if (change.category === 'skill') {
          if (change.type === 'add' && change.sourceAgent) {
            await fetchJson(`/api/agents/${change.agent}/skills`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                name: change.key,
                sourceAgent: change.sourceAgent,
                source: change.skillEntry?.source,
              }),
            });
          } else if (change.type === 'remove') {
            await fetchJson(
              `/api/agents/${change.agent}/skills/${encodeURIComponent(change.key)}`,
              { method: 'DELETE' }
            );
          } else {
            throw new Error(`Skill "${change.key}" is missing the staged metadata needed to apply this change.`);
          }
        } else if (change.category === 'plugin') {
          if (change.type === 'add' && change.sourceAgent) {
            await fetchJson(`/api/agents/${change.agent}/plugins`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                name: change.key,
                sourceAgent: change.sourceAgent,
              }),
            });
          } else if (change.type === 'remove') {
            await fetchJson(
              `/api/agents/${change.agent}/plugins/${encodeURIComponent(change.key)}`,
              { method: 'DELETE' }
            );
          } else {
            throw new Error(`Plugin "${change.key}" is missing the staged metadata needed to apply this change.`);
          }
        }
      });

      setPendingChanges(result.failed.map((failure) => failure.change));
      await fetchLiveConfigs();

      if (result.failed.length > 0) {
        showFeedback(
          'error',
          `Applied ${result.applied.length}/${changeCount}. ${result.failed[0]?.error} ${result.failed.length} change${result.failed.length > 1 ? 's remain' : ' remains'} staged.`
        );
      } else {
        setIsEditMode(false);
        showFeedback(
          'success',
          `Applied ${result.applied.length} change${result.applied.length > 1 ? 's' : ''}`
        );
      }
    } finally {
      setSaving(false);
    }
  }, [pendingChanges, fetchLiveConfigs, showFeedback]);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    if (!isEditMode) return;
    setActiveId(event.active.id as string);
  }, [isEditMode]);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveId(null);
      if (!isEditMode) return;
      const { active, over } = event;
      if (!over) return;

      const source = parseDragId(active.id as string);
      const target = parseDropId(over.id as string);
      if (!source || !target) return;
      if (source.agent === target.agent) return;
      if (source.category !== target.category) return;

      const sourceConfig = previewConfigs.find((c) => c.agent === source.agent);
      if (!sourceConfig) return;

      if (source.category === 'mcp') {
        const entry = sourceConfig.mcpServers[source.key];
        if (!entry) return;

        const alreadyStaged = pendingChanges.some(
          (c) => c.type === 'add' && c.category === 'mcp' && c.agent === target.agent && c.key === source.key
        );
        if (alreadyStaged) return;

        const nextChange: PendingChange = {
          id: nextChangeId(),
          type: 'add',
          category: 'mcp',
          agent: target.agent,
          key: source.key,
          entry,
          sourceAgent: source.agent,
        };
        const stagingError = canStagePendingAddition(previewConfigs, nextChange);
        if (stagingError) {
          showFeedback('error', stagingError);
          return;
        }

        void (async () => {
          try {
            const preflight = await fetchJson<McpPreflightResult>(
              `/api/agents/${target.agent}/mcps/check`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key: source.key, entry }),
              }
            );

            const firstError = preflight.checks.find((check) => check.status === 'error');
            if (firstError) {
              showFeedback('error', firstError.message);
              return;
            }

            setPendingChanges((prev) => [...prev, nextChange]);
          } catch (error) {
            showFeedback(
              'error',
              `Failed to validate MCP "${source.key}" before staging: ${(error as Error).message}`
            );
          }
        })();
      } else if (source.category === 'skill') {
        const skill = sourceConfig.skills.find((s) => s.name === source.key);
        if (!skill) return;

        const alreadyStaged = pendingChanges.some(
          (c) => c.type === 'add' && c.category === 'skill' && c.agent === target.agent && c.key === source.key
        );
        if (alreadyStaged) return;

        const nextChange: PendingChange = {
          id: nextChangeId(),
          type: 'add',
          category: 'skill',
          agent: target.agent,
          key: source.key,
          skillEntry: skill,
          sourceAgent: source.agent,
        };
        const stagingError = canStagePendingAddition(previewConfigs, nextChange);
        if (stagingError) {
          showFeedback('error', stagingError);
          return;
        }

        void (async () => {
          try {
            const preflight = await fetchJson<SkillPreflightResult>(
              `/api/agents/${target.agent}/skills/check`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  name: source.key,
                  sourceAgent: source.agent,
                  source: skill.source,
                }),
              }
            );

            const firstError = preflight.checks.find((check) => check.status === 'error');
            if (firstError) {
              showFeedback('error', firstError.message);
              return;
            }

            setPendingChanges((prev) => [...prev, nextChange]);
          } catch (error) {
            showFeedback(
              'error',
              `Failed to validate skill "${source.key}" before staging: ${(error as Error).message}`
            );
          }
        })();
      } else if (source.category === 'plugin') {
        const plugin = sourceConfig.skills.find(
          (entry) => entry.name === source.key && entry.kind === 'plugin'
        );
        if (!plugin) return;

        const alreadyStaged = pendingChanges.some(
          (c) => c.type === 'add' && c.category === 'plugin' && c.agent === target.agent && c.key === source.key
        );
        if (alreadyStaged) return;

        const nextChange: PendingChange = {
          id: nextChangeId(),
          type: 'add',
          category: 'plugin',
          agent: target.agent,
          key: source.key,
          pluginEntry: plugin,
          sourceAgent: source.agent,
        };
        const stagingError = canStagePendingAddition(previewConfigs, nextChange);
        if (stagingError) {
          showFeedback('error', stagingError);
          return;
        }

        void (async () => {
          try {
            const preflight = await fetchJson<{
              ok: boolean;
              checks: Array<{ label: string; status: 'ok' | 'warn' | 'error'; message: string }>;
            }>(`/api/agents/${target.agent}/plugins/check`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                name: source.key,
                sourceAgent: source.agent,
              }),
            });

            const firstError = preflight.checks.find((check) => check.status === 'error');
            if (firstError) {
              showFeedback('error', firstError.message);
              return;
            }

            setPendingChanges((prev) => [...prev, nextChange]);
          } catch (error) {
            showFeedback(
              'error',
              `Failed to validate plugin "${source.key}" before staging: ${(error as Error).message}`
            );
          }
        })();
      }
    },
    [isEditMode, previewConfigs, pendingChanges, showFeedback]
  );

  useEffect(() => {
    if (!isEditMode) {
      setActiveId(null);
    }
  }, [isEditMode]);

  const overlayData = (() => {
    if (!activeId) return null;
    const parsed = parseDragId(activeId);
    if (!parsed) return null;
    const config = previewConfigs.find((c) => c.agent === parsed.agent);
    if (!config) return null;

    if (parsed.category === 'mcp') {
      const entry = config.mcpServers[parsed.key];
      if (!entry) return null;
      const sublabel =
        entry.args && entry.args.length > 0
          ? `${entry.command} ${entry.args.join(' ')}`
          : entry.command;
      return { label: parsed.key, sublabel };
    } else if (parsed.category === 'skill') {
      const skill = config.skills.find((s) => s.name === parsed.key);
      if (!skill) return null;
      return { label: skill.name, sublabel: skill.source ?? 'local' };
    }
    const plugin = config.skills.find((entry) => entry.kind === 'plugin' && entry.name === parsed.key);
    if (!plugin) return null;
    return { label: plugin.name, sublabel: formatPluginSubtitle(plugin) };
  })();

  if (loading) {
    return (
      <div className="grid gap-4">
        <div className="flex items-center gap-2.5 py-3 text-zinc-500">
          <Loader2 size={20} className="animate-spin" /> Loading agent configs...
        </div>
      </div>
    );
  }

  const liveAgentCount = previewConfigs.filter((config) => config.exists).length;
  const totalPortableItems = previewConfigs.reduce(
    (sum, config) =>
      sum +
      Object.keys(config.mcpServers).length +
      splitAgentSkillEntries(config.skills).skills.length +
      splitAgentSkillEntries(config.skills).plugins.length,
    0
  );

  return (
    <div className="grid gap-6">
      <div className="flex flex-col items-stretch gap-4 border-b border-zinc-100 pb-4 lg:flex-row lg:items-center lg:justify-between lg:pb-1">
        <div className="grid gap-1">
          <h3 className="text-lg font-semibold tracking-tight text-zinc-900 m-0">Local agents</h3>
          <span className="text-sm text-zinc-500">Drag skills, MCPs, and plugins across columns.</span>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200/80 bg-white px-2.5 py-1 text-[11px] font-semibold text-zinc-500 shadow-sm">
            <ArrowRightLeft size={13} /> {liveAgentCount} agents
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200/80 bg-white px-2.5 py-1 text-[11px] font-semibold text-zinc-500 shadow-sm">
            <Boxes size={13} /> {totalPortableItems} items
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200/80 bg-white px-2.5 py-1 text-[11px] font-semibold text-zinc-500 shadow-sm">
            <Save size={13} /> {pendingChanges.length} staged
          </span>
          <button
            className={`inline-flex min-h-[36px] items-center gap-2 rounded-lg border px-3.5 text-sm font-medium shadow-sm transition-all disabled:opacity-50 ${isEditMode ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-200/80 bg-white text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900'}`}
            type="button"
            onClick={() => setIsEditMode((value) => !value)}
            disabled={saving}
          >
            {isEditMode ? <Check size={14} /> : <PencilLine size={14} />}
            {isEditMode ? 'Done editing' : 'Edit items'}
          </button>
          <button
            className="inline-flex min-h-[36px] items-center gap-2 rounded-lg border border-zinc-200/80 bg-white px-3.5 text-sm font-medium text-zinc-600 shadow-sm transition-all hover:bg-zinc-50 hover:text-zinc-900 disabled:opacity-50"
            onClick={() => {
              setPendingChanges([]);
              void fetchLiveConfigs();
            }}
            disabled={saving}
          >
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      </div>

      <PendingChangesBar
        changes={pendingChanges}
        onUndoChange={handleUndoChange}
        onDiscardAll={handleDiscardAll}
        onSave={handleSave}
        saving={saving}
      />

      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
          {previewConfigs.map((config) => (
            <AgentColumn
              key={config.agent}
              config={config}
              pendingAdded={pendingAddedMap.get(config.agent) ?? new Set()}
              pendingRemoved={pendingRemovedMap.get(config.agent) ?? new Set()}
              pendingSkillAdded={pendingSkillAddedMap.get(config.agent) ?? new Set()}
              pendingSkillRemoved={pendingSkillRemovedMap.get(config.agent) ?? new Set()}
              pendingPluginAdded={pendingPluginAddedMap.get(config.agent) ?? new Set()}
              pendingPluginRemoved={pendingPluginRemovedMap.get(config.agent) ?? new Set()}
              onStagedRemove={handleStagedRemove}
              editable={isEditMode}
            />
          ))}
        </div>

        <DragOverlay modifiers={[snapToPointer]}>
          {overlayData ? (
            <OverlayCard label={overlayData.label} sublabel={overlayData.sublabel} />
          ) : null}
        </DragOverlay>
      </DndContext>

      {feedback && (
        <div className={`inline-flex items-center gap-2 rounded-lg border px-3.5 py-3 text-sm transition-all ${feedback.type === 'error' ? 'border-red-200/80 bg-red-50/50 text-red-800' : 'border-emerald-200/80 bg-emerald-50/50 text-emerald-800'}`}>
          {feedback.type === 'success' ? <Check size={16} /> : null}
          <span>{feedback.message}</span>
        </div>
      )}
    </div>
  );
}
