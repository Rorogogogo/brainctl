import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  Check,
  FileText,
  GripVertical,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Server,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface AgentMcpEntry {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

interface AgentSkillEntry {
  name: string;
  source?: string;
}

interface AgentLiveConfig {
  agent: string;
  configPath: string;
  exists: boolean;
  mcpServers: Record<string, AgentMcpEntry>;
  skills: AgentSkillEntry[];
}

interface PendingChange {
  id: string;
  type: 'add' | 'remove';
  agent: string;
  key: string;
  entry?: AgentMcpEntry;
  sourceAgent?: string;
}

type FeedbackState = { type: 'success' | 'error'; message: string } | null;

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

function parseDragId(id: string): { agent: string; key: string } | null {
  const parts = id.split(':');
  if (parts.length < 3) return null;
  return { agent: parts[0], key: parts.slice(2).join(':') };
}

function parseDropId(id: string): { agent: string } | null {
  const parts = id.split(':');
  if (parts.length < 2) return null;
  return { agent: parts[0] };
}

const AGENT_LABELS: Record<string, string> = {
  claude: 'Claude',
  codex: 'Codex',
  gemini: 'Gemini',
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
  }));
  for (const change of changes) {
    const config = result.find((c) => c.agent === change.agent);
    if (!config) continue;
    if (change.type === 'add' && change.entry) {
      config.mcpServers[change.key] = change.entry;
    } else if (change.type === 'remove') {
      delete config.mcpServers[change.key];
    }
  }
  return result;
}

function getPendingKeys(changes: PendingChange[]): {
  added: Map<string, Set<string>>;
  removed: Map<string, Set<string>>;
} {
  const added = new Map<string, Set<string>>();
  const removed = new Map<string, Set<string>>();
  for (const change of changes) {
    const map = change.type === 'add' ? added : removed;
    if (!map.has(change.agent)) map.set(change.agent, new Set());
    map.get(change.agent)!.add(change.key);
  }
  return { added, removed };
}

/* ------------------------------------------------------------------ */
/*  DnD primitives                                                     */
/* ------------------------------------------------------------------ */

function DraggableCard({
  id,
  label,
  sublabel,
  status,
  onRemove,
}: {
  id: string;
  label: string;
  sublabel: string;
  status?: 'added' | 'removed';
  onRemove?: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id });

  const style = transform
    ? { transform: `translate(${transform.x}px, ${transform.y}px)` }
    : undefined;

  const statusClass =
    status === 'added'
      ? ' is-pending-add'
      : status === 'removed'
      ? ' is-pending-remove'
      : '';

  return (
    <div
      ref={setNodeRef}
      className={`profile-card${isDragging ? ' is-dragging' : ''}${statusClass}`}
      style={style}
    >
      <div className="profile-card-row">
        <span {...listeners} {...attributes} className="profile-card-grip-area">
          <GripVertical size={14} className="profile-card-grip" />
        </span>
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
        <GripVertical size={14} className="profile-card-grip" />
        <div className="profile-card-content">
          <strong>{label}</strong>
          <span className="muted-copy">{sublabel}</span>
        </div>
      </div>
    </div>
  );
}

function DroppableZone({
  id,
  label,
  count,
  children,
}: {
  id: string;
  label: string;
  count: number;
  children: React.ReactNode;
}) {
  const { isOver, setNodeRef } = useDroppable({ id });

  return (
    <div
      ref={setNodeRef}
      className={`profile-drop-zone${isOver ? ' is-over' : ''}`}
    >
      <p className="eyebrow">
        {label} ({count})
      </p>
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
  onStagedRemove,
}: {
  config: AgentLiveConfig;
  pendingAdded: Set<string>;
  pendingRemoved: Set<string>;
  onStagedRemove: (agent: string, key: string) => void;
}) {
  const mcpEntries = Object.entries(config.mcpServers);

  return (
    <div className="profile-column panel-inner">
      <div className="profile-column-header">
        <div className="profile-column-title">
          <p className="eyebrow">{AGENT_LABELS[config.agent] ?? config.agent}</p>
          <p className="muted-copy agent-config-path">{config.configPath}</p>
        </div>
        <span
          className={`status-chip${config.exists ? ' profile-active-badge' : ''}`}
        >
          {config.exists ? 'Found' : 'No config'}
        </span>
      </div>

      {/* MCP Servers */}
      <DroppableZone
        id={`${config.agent}:mcps`}
        label="MCP Servers"
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
              status={status}
              onRemove={() => onStagedRemove(config.agent, key)}
            />
          );
        })}
        {mcpEntries.length === 0 && (
          <p className="muted-copy">No MCPs configured.</p>
        )}
      </DroppableZone>

      {/* Skills */}
      <div className="agent-skills-section">
        <p className="eyebrow">
          <FileText size={12} /> Skills ({config.skills.length})
        </p>
        {config.skills.length > 0 ? (
          <div className="agent-skills-list">
            {config.skills.map((skill) => (
              <div key={skill.name} className="agent-skill-item">
                <strong>{skill.name}</strong>
                {skill.source && (
                  <span className="muted-copy">{skill.source}</span>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="muted-copy">No skills installed.</p>
        )}
      </div>
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
              <strong>{change.key}</strong>
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
  const { added: pendingAddedMap, removed: pendingRemovedMap } =
    getPendingKeys(pendingChanges);

  const handleStagedRemove = useCallback(
    (agent: string, key: string) => {
      const alreadyStaged = pendingChanges.some(
        (c) => c.agent === agent && c.key === key
      );
      if (alreadyStaged) return;
      setPendingChanges((prev) => [
        ...prev,
        { id: nextChangeId(), type: 'remove', agent, key },
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
      .map((c) =>
        c.type === 'add'
          ? `+ ${c.key} -> ${AGENT_LABELS[c.agent]}`
          : `- ${c.key} from ${AGENT_LABELS[c.agent]}`
      )
      .join('\n');

    const confirmed = window.confirm(
      `Apply ${changeCount} change${changeCount > 1 ? 's' : ''} to agent configs?\n\n${summary}`
    );
    if (!confirmed) return;

    setSaving(true);
    let successCount = 0;
    let lastError = '';

    for (const change of pendingChanges) {
      try {
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
        }
        successCount++;
      } catch (err) {
        lastError = (err as Error).message;
      }
    }

    setPendingChanges([]);
    await fetchLiveConfigs();
    setSaving(false);

    if (lastError) {
      showFeedback('error', `Applied ${successCount}/${changeCount}. Error: ${lastError}`);
    } else {
      showFeedback('success', `Applied ${successCount} change${successCount > 1 ? 's' : ''}`);
    }
  }, [pendingChanges, fetchLiveConfigs, showFeedback]);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveId(null);
      const { active, over } = event;
      if (!over) return;

      const source = parseDragId(active.id as string);
      const target = parseDropId(over.id as string);
      if (!source || !target) return;
      if (source.agent === target.agent) return;

      const sourceConfig = previewConfigs.find((c) => c.agent === source.agent);
      if (!sourceConfig) return;
      const entry = sourceConfig.mcpServers[source.key];
      if (!entry) return;

      const alreadyStaged = pendingChanges.some(
        (c) => c.type === 'add' && c.agent === target.agent && c.key === source.key
      );
      if (alreadyStaged) return;

      setPendingChanges((prev) => [
        ...prev,
        {
          id: nextChangeId(),
          type: 'add',
          agent: target.agent,
          key: source.key,
          entry,
          sourceAgent: source.agent,
        },
      ]);
    },
    [previewConfigs, pendingChanges]
  );

  const overlayData = (() => {
    if (!activeId) return null;
    const parsed = parseDragId(activeId);
    if (!parsed) return null;
    const config = previewConfigs.find((c) => c.agent === parsed.agent);
    if (!config) return null;
    const entry = config.mcpServers[parsed.key];
    if (!entry) return null;
    const sublabel =
      entry.args && entry.args.length > 0
        ? `${entry.command} ${entry.args.join(' ')}`
        : entry.command;
    return { label: parsed.key, sublabel };
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

  return (
    <div className="view-stack">
      <div className="section-header">
        <div>
          <p className="eyebrow">Agent profiles</p>
          <h3>Drag MCPs between agents</h3>
        </div>
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

      <DndContext
        sensors={sensors}
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
              onStagedRemove={handleStagedRemove}
            />
          ))}
        </div>

        <DragOverlay>
          {overlayData ? (
            <OverlayCard label={overlayData.label} sublabel={overlayData.sublabel} />
          ) : null}
        </DragOverlay>
      </DndContext>

      <PendingChangesBar
        changes={pendingChanges}
        onUndoChange={handleUndoChange}
        onDiscardAll={handleDiscardAll}
        onSave={handleSave}
        saving={saving}
      />

      {feedback && (
        <div className={`save-feedback${feedback.type === 'error' ? ' is-error' : ''}`}>
          {feedback.type === 'success' ? <Check size={16} /> : null}
          <span>{feedback.message}</span>
        </div>
      )}
    </div>
  );
}
