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
      ? ' is-pending-add'
      : status === 'removed'
      ? ' is-pending-remove'
      : '';
  const dragProps = editable ? { ...listeners, ...attributes } : {};

  return (
    <div
      ref={setNodeRef}
      className={`profile-card${isDragging ? ' is-dragging' : ''}${statusClass}${editable ? ' is-editable' : ''}`}
      {...dragProps}
    >
      <div className="profile-card-row">
        {icon ? <span className="profile-card-kind">{icon}</span> : null}
        <div className="profile-card-content">
          <strong>{label}</strong>
          <span className="muted-copy">{sublabel}</span>
        </div>
        {status && (
          <span className={`pending-badge${status === 'added' ? ' is-add' : ' is-remove'}`}>
            {status === 'added' ? '+' : '-'}
          </span>
        )}
        {onRemove && !status && (
          <button
            className="profile-card-remove"
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
    <div className="profile-card-overlay">
      <div className="profile-card-row">
        <span className="profile-card-kind">
          <ArrowRightLeft size={14} />
        </span>
        <div className="profile-card-content">
          <strong>{label}</strong>
          <span className="muted-copy">{sublabel}</span>
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
      ? ' is-pending-add'
      : status === 'removed'
      ? ' is-pending-remove'
      : '';
  const skillCount = details?.length ?? 0;
  const hasDetails = skillCount > 0;
  const dragProps = editable ? { ...listeners, ...attributes } : {};

  return (
    <div
      ref={setNodeRef}
      className={`profile-card${isDragging ? ' is-dragging' : ''}${statusClass}${editable ? ' is-editable' : ''}`}
      {...dragProps}
    >
      <div className="profile-card-row">
        <div className="profile-card-content">
          <strong>{label}</strong>
          <span className="muted-copy">{sublabel}</span>
        </div>
        {status ? (
          <span className={`pending-badge${status === 'added' ? ' is-add' : ' is-remove'}`}>
            {status === 'added' ? '+' : '-'}
          </span>
        ) : (
          <span className="pending-badge">plugin</span>
        )}
        {hasDetails ? (
          <button
            className="profile-card-toggle"
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
            className="profile-card-remove"
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
        <div className="profile-card-content profile-card-details">
          <span className="muted-copy">
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
      className={`profile-drop-zone${isOver ? ' is-over' : ''}`}
    >
      <div className="profile-drop-zone-header">
        <div className="profile-drop-zone-title">
          <span className="profile-drop-zone-icon">{icon}</span>
          <p className="eyebrow">{label}</p>
        </div>
        <span className="profile-count-pill">{count}</span>
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
    <div className={`profile-column panel-inner profile-column-${config.agent}`}>
      <div className="profile-column-header">
        <div className="profile-column-title">
          <span className="profile-agent-mark">
            <AgentLogo agent={config.agent} className="profile-agent-logo" />
          </span>
          <div>
          <p className="eyebrow">{AGENT_LABELS[config.agent] ?? config.agent}</p>
          <p className="muted-copy agent-config-path">{config.configPath}</p>
          </div>
        </div>
        <span
          className={`status-chip${config.exists ? ' profile-active-badge' : ''}`}
        >
          {config.exists ? 'Found' : 'No config'}
        </span>
      </div>

      <div className="profile-agent-stats">
        <span className="profile-stat-chip">
          <Server size={12} /> {mcpEntries.length} MCPs
        </span>
        <span className="profile-stat-chip">
          <FileText size={12} /> {localSkills.length} Skills
        </span>
        <span className="profile-stat-chip">
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
          <p className="muted-copy">No MCPs configured.</p>
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
          <p className="muted-copy">No skills installed.</p>
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
          <p className="muted-copy">No plugins discovered.</p>
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
    <div className="pending-changes-bar panel-inner">
      <div className="pending-changes-header">
        <p className="eyebrow">
          {changes.length} pending change{changes.length > 1 ? 's' : ''}
        </p>
        <div className="pending-changes-actions">
          <button className="secondary-button" onClick={onDiscardAll} disabled={saving}>
            <Undo2 size={14} /> Discard all
          </button>
          <button className="run-button" onClick={onSave} disabled={saving}>
            {saving ? <Loader2 size={14} className="spinner" /> : <Save size={14} />}{' '}
            Save & apply
          </button>
        </div>
      </div>
      <div className="pending-changes-list">
        {changes.map((change) => (
          <div
            key={change.id}
            className={`pending-change-item${change.type === 'add' ? ' is-add' : ' is-remove'}`}
          >
            <span className="pending-change-icon">
              {change.type === 'add' ? <Plus size={12} /> : <X size={12} />}
            </span>
            <span className="pending-change-text">
              <strong>[{change.category}] {change.key}</strong>
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
              className="pending-change-undo"
              onClick={() => onUndoChange(change.id)}
              title="Undo this change"
              disabled={saving}
            >
              <Undo2 size={12} />
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
      <div className="view-stack">
        <div className="profile-loading">
          <Loader2 size={20} className="spinner" /> Loading agent configs...
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
    <div className="view-stack">
      <div className="profile-stage-header">
        <div className="profile-stage-copy">
          <h3>Local agents</h3>
          <span className="muted-copy">Drag skills, MCPs, and plugins across columns.</span>
        </div>

        <div className="profile-stage-toolbar">
          <span className="profile-stage-pill">
            <ArrowRightLeft size={13} /> {liveAgentCount} agents
          </span>
          <span className="profile-stage-pill">
            <Boxes size={13} /> {totalPortableItems} items
          </span>
          <span className="profile-stage-pill">
            <Save size={13} /> {pendingChanges.length} staged
          </span>
          <button
            className={`secondary-button profile-edit-button${isEditMode ? ' is-active' : ''}`}
            type="button"
            onClick={() => setIsEditMode((value) => !value)}
            disabled={saving}
          >
            {isEditMode ? <Check size={14} /> : <PencilLine size={14} />}
            {isEditMode ? 'Done editing' : 'Edit items'}
          </button>
          <button
            className="secondary-button"
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
        <div className="profile-columns">
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
        <div className={`save-feedback${feedback.type === 'error' ? ' is-error' : ''}`}>
          {feedback.type === 'success' ? <Check size={16} /> : null}
          <span>{feedback.message}</span>
        </div>
      )}
    </div>
  );
}
