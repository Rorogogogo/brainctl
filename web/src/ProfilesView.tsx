import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDndContext,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
  type Modifier,
} from '@dnd-kit/core';
import {
  ArrowRightLeft,
  Bot,
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
  Terminal,
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
import ConfirmDialog from './ConfirmDialog';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */


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

function parseDropId(id: string): { agent: string; category: 'mcp' | 'skill' | 'plugin' | 'column' } | null {
  const m = id.match(/^(\w+):(mcps|skills|plugins|column)(?::anchor)?$/);
  if (!m) return null;
  return {
    agent: m[1],
    category: m[2] === 'mcps' ? 'mcp' : m[2] === 'skills' ? 'skill' : m[2] === 'plugins' ? 'plugin' : 'column',
  };
}

const AGENT_LABELS: Record<string, string> = {
  claude: 'Claude',
  codex: 'Codex',
  gemini: 'Gemini',
};

const customCollisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  if (pointerCollisions.length === 0) return pointerCollisions;

  const { active, droppableContainers } = args;
  const source = parseDragId(active.id as string);
  if (!source) return pointerCollisions;

  const firstOver = pointerCollisions[0].id as string;
  const target = parseDropId(firstOver);

  if (target && target.agent !== source.agent) {
    const correctCategory = source.category === 'mcp' ? 'mcps' : source.category === 'skill' ? 'skills' : 'plugins';
    const correctZoneId = `${target.agent}:${correctCategory}:anchor`;
    const correctDroppable = droppableContainers.find(d => d.id === correctZoneId);
    if (correctDroppable) {
      return [{ id: correctZoneId, data: correctDroppable.data, value: 100 }];
    }
  }

  return pointerCollisions;
};

function DropAnchorWrapper({ id, children }: { id: string; children?: ReactNode }) {
  const { setNodeRef } = useDroppable({ id });
  return <div ref={setNodeRef} className={children ? "w-full" : "h-0 w-full"}>{children}</div>;
}

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
    remoteMcpServers: { ...c.remoteMcpServers },
    skills: [...c.skills],
  }));
  for (const change of changes) {
    const config = result.find((c) => c.agent === change.agent);
    if (!config) continue;
    if (change.category === 'mcp') {
      if (change.type === 'add' && change.entry) {
        config.mcpServers[change.key] = change.entry;
        delete config.remoteMcpServers[change.key];
      } else if (change.type === 'add' && change.remoteEntry) {
        config.remoteMcpServers[change.key] = change.remoteEntry;
        delete config.mcpServers[change.key];
      } else if (change.type === 'remove') {
        delete config.mcpServers[change.key];
        delete config.remoteMcpServers[change.key];
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
      ? ' border-emerald-200 bg-emerald-50/50 shadow-[0_0_12px_rgba(16,185,129,0.15)] ring-1 ring-emerald-400/20'
      : status === 'removed'
      ? ' border-red-200 bg-red-50 opacity-50 line-through'
      : ' border-zinc-200 bg-white hover:border-zinc-300';
      
  const editableClass = editable
    ? ' cursor-grab active:cursor-grabbing hover:shadow-sm'
    : '';

  const dragProps = editable ? { ...listeners, ...attributes } : {};

  return (
    <div
      ref={setNodeRef}
      className={`flex items-start gap-3 rounded-xl border p-3 transition-all duration-200 group ${isDragging ? 'opacity-50' : ''}${statusClass}${editableClass}`}
      {...dragProps}
    >
      <div className="flex w-full items-start gap-3">
        {icon ? <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-zinc-200 bg-zinc-50 text-zinc-600 transition-colors group-hover:text-zinc-900">{icon}</span> : null}
        <div className="grid min-w-0 flex-1 gap-0.5">
          <strong className="truncate text-sm font-semibold text-zinc-900">{label}</strong>
          <span className="truncate text-xs text-zinc-500">{sublabel}</span>
        </div>
        {status && (
          <span className={`inline-flex shrink-0 items-center justify-center rounded-md px-2 py-0.5 text-xs font-medium leading-none ${status === 'added' ? 'bg-zinc-100 text-zinc-700' : 'bg-red-100 text-red-700'}`}>
            {status === 'added' ? 'Added' : 'Removed'}
          </span>
        )}
        {onRemove && !status && (
          <button
            className="grid size-8 shrink-0 place-items-center rounded-lg border border-transparent text-zinc-400 transition-colors hover:bg-red-50 hover:text-red-600"
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={onRemove}
            title={`Remove ${label}`}
          >
            <Trash2 size={16} />
          </button>
        )}
      </div>
    </div>
  );
}

function OverlayCard({ label, sublabel }: { label: string; sublabel: string }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-zinc-200 bg-white p-3 shadow-lg rotate-2">
      <div className="flex w-full items-start gap-3 text-zinc-900">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-zinc-200 bg-zinc-50 text-zinc-600">
          <ArrowRightLeft size={16} />
        </span>
        <div className="grid min-w-0 flex-1 gap-0.5">
          <strong className="truncate text-sm font-semibold text-zinc-900">{label}</strong>
          <span className="truncate text-xs text-zinc-500">{sublabel}</span>
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
  details?: Array<{ name: string; kind: 'skill' | 'mcp' | 'agent' | 'command' }>;
  status?: 'added' | 'removed';
  onRemove?: () => void;
  editable: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id, disabled: !editable });
  const [expanded, setExpanded] = useState(false);

  const statusClass =
    status === 'added'
      ? ' border-emerald-200 bg-emerald-50/50 shadow-[0_0_12px_rgba(16,185,129,0.15)] ring-1 ring-emerald-400/20'
      : status === 'removed'
      ? ' border-red-200 bg-red-50 opacity-50 line-through'
      : ' border-zinc-200 bg-white hover:border-zinc-300';

  const editableClass = editable
    ? ' cursor-grab active:cursor-grabbing hover:shadow-sm'
    : '';

  const detailCount = details?.length ?? 0;
  const hasDetails = detailCount > 0;
  const dragProps = editable ? { ...listeners, ...attributes } : {};

  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col items-start gap-2 rounded-xl border p-3 transition-all duration-200 group ${isDragging ? 'opacity-50' : ''}${statusClass}${editableClass}`}
      {...dragProps}
    >
      <div className="flex w-full items-start gap-3">
        <div className="grid min-w-0 flex-1 gap-0.5">
          <strong className="truncate text-sm font-semibold text-zinc-900">{label}</strong>
          <span className="truncate text-xs text-zinc-500">{sublabel}</span>
        </div>
        {status ? (
          <span className={`inline-flex shrink-0 items-center justify-center rounded-md px-2 py-0.5 text-xs font-medium leading-none ${status === 'added' ? 'bg-zinc-100 text-zinc-700' : 'bg-red-100 text-red-700'}`}>
            {status === 'added' ? 'Added' : 'Removed'}
          </span>
        ) : (
          <span className="inline-flex shrink-0 items-center justify-center rounded-md border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-xs font-medium leading-none text-zinc-600">Plugin</span>
        )}
        {hasDetails ? (
          <button
            className="grid size-8 shrink-0 place-items-center rounded-lg border border-transparent text-zinc-400 transition-colors hover:bg-zinc-50 hover:text-zinc-900"
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => setExpanded((value) => !value)}
            title={expanded ? `Collapse ${label}` : `Expand ${label}`}
            aria-expanded={expanded}
          >
            {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
        ) : null}
        {onRemove && !status ? (
          <button
            className="grid size-8 shrink-0 place-items-center rounded-lg border border-transparent text-zinc-400 transition-colors hover:bg-red-50 hover:text-red-600"
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={onRemove}
            title={`Remove ${label}`}
          >
            <Trash2 size={16} />
          </button>
        ) : null}
      </div>
      {hasDetails && expanded ? (
        <div className="flex flex-wrap gap-2 pt-2 w-full border-t border-zinc-100 mt-1">
          {details!.map((item) => (
            <span
              key={`${item.kind}:${item.name}`}
              className={`inline-flex items-center gap-1.5 rounded-md border bg-white px-2 py-0.5 text-[11px] font-medium shadow-sm ${
                item.kind === 'mcp' ? 'border-indigo-200 text-indigo-700' :
                item.kind === 'agent' ? 'border-amber-200 text-amber-700' :
                item.kind === 'command' ? 'border-sky-200 text-sky-700' :
                'border-violet-200 text-violet-700'
              }`}
            >
              {item.kind === 'mcp' && <Server size={10} className="opacity-70" />}
              {item.kind === 'agent' && <Bot size={10} className="opacity-70" />}
              {item.kind === 'command' && <Terminal size={10} className="opacity-70" />}
              {item.kind === 'skill' && <FileText size={10} className="opacity-70" />}
              <span className="opacity-80 text-[10px] uppercase tracking-wider">{item.kind}</span>
              <span className="text-zinc-800">{item.name}</span>
            </span>
          ))}
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
  const [expanded, setExpanded] = useState(true);
  const { active, over } = useDndContext();

  const isHighlighted = () => {
    if (!active || !over) return false;
    const source = parseDragId(active.id as string);
    const target = parseDropId(over.id as string);
    const thisZone = parseDropId(id);
    if (!source || !target || !thisZone) return false;

    return source.category === thisZone.category && target.agent === thisZone.agent;
  };

  const highlight = isHighlighted() || (isOver && !active);

  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col gap-3 rounded-2xl p-4 transition-all duration-300 ${highlight ? 'bg-zinc-100 border-2 border-zinc-300 border-dashed shadow-inner' : 'bg-zinc-50/50 border border-zinc-200 border-dashed'} ${!expanded ? 'min-h-0 pb-4' : 'min-h-[120px]'}`}
    >
      <div 
        className={`flex items-center justify-between gap-4 cursor-pointer select-none transition-colors hover:opacity-80 ${expanded ? 'border-b border-zinc-200/60 pb-2' : ''}`}
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          <span className="grid size-7 shrink-0 place-items-center rounded-lg border border-zinc-200 bg-white text-zinc-600">{icon}</span>
          <p className="text-xs font-semibold text-zinc-600 m-0">{label}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex min-w-[28px] items-center justify-center rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-xs font-medium text-zinc-600 shadow-sm">{count}</span>
          <span className="text-zinc-400">
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </span>
        </div>
      </div>
      {expanded && (
        <div className="grid gap-2 relative">
          {children}
        </div>
      )}
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
  const { setNodeRef } = useDroppable({ id: `${config.agent}:column` });
  const { active, over } = useDndContext();

  const isHighlighted = () => {
    if (!active || !over) return false;
    const source = parseDragId(active.id as string);
    const target = parseDropId(over.id as string);
    if (!source || !target) return false;
    return target.agent === config.agent && source.agent !== config.agent;
  };

  const highlight = isHighlighted();

  const mcpEntries = [
    ...Object.entries(config.mcpServers).map(([key, entry]) => ({
      key,
      type: 'local' as const,
      sublabel: entry.args && entry.args.length > 0 ? `${entry.command} ${entry.args.join(' ')}` : entry.command,
    })),
    ...Object.entries(config.remoteMcpServers).map(([key, entry]) => ({
      key,
      type: 'remote' as const,
      sublabel: `${entry.transport.toUpperCase()} ${entry.url}`,
    })),
  ];
  const { skills: localSkills, plugins } = splitAgentSkillEntries(config.skills);

  return (
    <div 
      ref={setNodeRef}
      className={`flex flex-col gap-4 profile-column-${config.agent} transition-all duration-300 rounded-2xl ${highlight ? 'bg-zinc-50 ring-4 ring-zinc-200/50 shadow-inner p-4 -m-4' : ''}`}
    >
      <div className="flex items-start justify-between gap-4 border-b border-zinc-100 pb-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-12 place-items-center rounded-xl border border-zinc-200 bg-white text-zinc-900 shadow-sm">
            <AgentLogo agent={config.agent} className="size-6 overflow-hidden" />
          </span>
          <div className="space-y-0.5 overflow-hidden">
            <p className="text-lg font-semibold text-zinc-900 m-0">{AGENT_LABELS[config.agent] ?? config.agent}</p>
            <p className="font-mono text-[10px] text-zinc-400 m-0 break-all">{config.configPath}</p>
          </div>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium shadow-sm ${config.exists ? 'border-zinc-200 bg-zinc-50 text-zinc-700' : 'border-zinc-200 bg-zinc-50 text-zinc-400'}`}
        >
          {config.exists ? 'Active' : 'Offline'}
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs font-medium text-zinc-600">
          <Server size={14} /> {mcpEntries.length} MCPs
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs font-medium text-zinc-600">
          <FileText size={14} /> {localSkills.length} Skills
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs font-medium text-zinc-600">
          <Boxes size={14} /> {plugins.length} Plugins
        </span>
      </div>

      {/* Skills */}
      <DroppableZone
        id={`${config.agent}:skills`}
        label="Skills"
        icon={<FileText size={16} />}
        count={localSkills.length}
      >
        {localSkills.map((skill, index) => {
          const status = pendingSkillAdded.has(skill.name)
            ? ('added' as const)
            : pendingSkillRemoved.has(skill.name)
            ? ('removed' as const)
            : undefined;

          const card = (
            <DraggableCard
              key={skill.name}
              id={`${config.agent}:skill:${skill.name}`}
              label={skill.name}
              sublabel={skill.source ?? 'local'}
              icon={<FileText size={16} />}
              status={status}
              onRemove={editable ? () => onStagedRemove(config.agent, 'skill', skill.name) : undefined}
              editable={editable}
            />
          );

          if (index === localSkills.length - 1) {
            return <DropAnchorWrapper key={skill.name} id={`${config.agent}:skills:anchor`}>{card}</DropAnchorWrapper>;
          }
          return card;
        })}
        {localSkills.length === 0 && (
          <DropAnchorWrapper id={`${config.agent}:skills:anchor`}>
            <p className="text-sm font-medium text-zinc-400 m-3">No skills installed.</p>
          </DropAnchorWrapper>
        )}
      </DroppableZone>

      {/* MCP Servers */}
      <DroppableZone
        id={`${config.agent}:mcps`}
        label="MCP Servers"
        icon={<Server size={16} />}
        count={mcpEntries.length}
      >
        {mcpEntries.map(({ key, sublabel, type }, index) => {
          const status = pendingAdded.has(key)
            ? ('added' as const)
            : pendingRemoved.has(key)
            ? ('removed' as const)
            : undefined;

          const card = (
            <DraggableCard
              key={key}
              id={`${config.agent}:mcp:${key}`}
              label={key}
              sublabel={type === 'remote' ? `[remote] ${sublabel}` : sublabel}
              icon={<Server size={16} />}
              status={status}
              onRemove={editable ? () => onStagedRemove(config.agent, 'mcp', key) : undefined}
              editable={editable}
            />
          );

          if (index === mcpEntries.length - 1) {
            return <DropAnchorWrapper key={key} id={`${config.agent}:mcps:anchor`}>{card}</DropAnchorWrapper>;
          }
          return card;
        })}
        {mcpEntries.length === 0 && (
          <DropAnchorWrapper id={`${config.agent}:mcps:anchor`}>
            <p className="text-sm font-medium text-zinc-400 m-3">No MCPs configured.</p>
          </DropAnchorWrapper>
        )}
      </DroppableZone>

      <DroppableZone
        id={`${config.agent}:plugins`}
        label="Plugins"
        icon={<Boxes size={16} />}
        count={plugins.length}
      >
        {plugins.map((plugin, index) => {
          const status = pendingPluginAdded.has(plugin.name)
            ? ('added' as const)
            : pendingPluginRemoved.has(plugin.name)
            ? ('removed' as const)
            : undefined;

          const card = (
            <StaticCard
              key={plugin.name}
              id={`${config.agent}:plugin:${plugin.name}`}
              label={plugin.name}
              sublabel={formatPluginSubtitle(plugin)}
              details={[
                ...(plugin.pluginSkills ?? []).map((name) => ({ name, kind: 'skill' as const })),
                ...(plugin.pluginMcps ?? []).map((name) => ({ name, kind: 'mcp' as const })),
                ...(plugin.pluginAgents ?? []).map((name) => ({ name, kind: 'agent' as const })),
                ...(plugin.pluginCommands ?? []).map((name) => ({ name, kind: 'command' as const })),
              ]}
              status={status}
              onRemove={
                editable &&
                (plugin.managed ||
                  ((config.agent === 'codex' || config.agent === 'claude') &&
                    typeof plugin.installPath === 'string' &&
                    typeof plugin.source === 'string'))
                  ? () => onStagedRemove(config.agent, 'plugin', plugin.name)
                  : undefined
              }
              editable={editable}
            />
          );

          if (index === plugins.length - 1) {
            return <DropAnchorWrapper key={plugin.name} id={`${config.agent}:plugins:anchor`}>{card}</DropAnchorWrapper>;
          }
          return card;
        })}
        {plugins.length === 0 && (
          <DropAnchorWrapper id={`${config.agent}:plugins:anchor`}>
            <p className="text-sm font-medium text-zinc-400 m-3">No plugins discovered.</p>
          </DropAnchorWrapper>
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
    <div className="sticky top-6 z-20 grid gap-4 rounded-2xl border border-zinc-200 bg-white p-5 shadow-lg mb-8">
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <p className="text-sm font-semibold text-zinc-900 m-0">
          {changes.length} pending change{changes.length > 1 ? 's' : ''}
        </p>
        <div className="flex flex-wrap gap-3">
          <button className="inline-flex h-9 items-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-50" onClick={onDiscardAll} disabled={saving}>
            <Undo2 size={16} /> Discard all
          </button>
          <button className="inline-flex h-9 items-center gap-2 rounded-xl bg-zinc-900 px-5 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-50 shadow-sm" onClick={onSave} disabled={saving}>
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}{' '}
            Save & apply
          </button>
        </div>
      </div>
      <div className="grid gap-2">
        {changes.map((change) => (
          <div
            key={change.id}
            className={`flex items-center gap-3 rounded-xl border p-3 text-sm font-medium ${change.type === 'add' ? 'border-zinc-200 bg-zinc-50 text-zinc-900' : 'border-red-200 bg-red-50 text-red-900'}`}
          >
            <span className={`grid size-8 place-items-center shrink-0 rounded-lg ${change.type === 'add' ? 'bg-white border border-zinc-200 text-zinc-600' : 'bg-white border border-red-200 text-red-600'}`}>
              {change.type === 'add' ? <Plus size={16} /> : <X size={16} />}
            </span>
            <span className="flex-1 min-w-0 truncate">
              <strong className="text-zinc-900">[{change.category}] {change.key}</strong>
              {change.type === 'add' ? (
                <>
                  {' '}→ {AGENT_LABELS[change.agent]}
                  {change.sourceAgent ? ` (from ${AGENT_LABELS[change.sourceAgent]})` : ''}
                </>
              ) : (
                <> removed from {AGENT_LABELS[change.agent]}</>
              )}
            </span>
            <button
              className="grid size-8 shrink-0 place-items-center rounded-lg border border-transparent text-zinc-400 transition-colors hover:bg-white hover:border-zinc-200 hover:text-zinc-900 hover:shadow-sm"
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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [refreshState, setRefreshState] = useState<'idle' | 'loading' | 'success'>('idle');

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const showFeedback = useCallback(
    (type: 'success' | 'error', message: string) => {
      if (type === 'success') {
        toast.success(message);
      } else {
        toast.error(message);
      }
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

  const handleRefresh = useCallback(async () => {
    if (refreshState === 'loading') return;
    setRefreshState('loading');
    setPendingChanges([]);
    const startedAt = Date.now();
    try {
      await fetchLiveConfigs();
      const elapsed = Date.now() - startedAt;
      if (elapsed < 400) {
        await new Promise((resolve) => setTimeout(resolve, 400 - elapsed));
      }
      setRefreshState('success');
      toast.success('Agent configs refreshed');
      setTimeout(() => {
        setRefreshState((current) => (current === 'success' ? 'idle' : current));
      }, 1200);
    } catch {
      setRefreshState('idle');
    }
  }, [fetchLiveConfigs, refreshState]);

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

  const handleSave = useCallback(() => {
    if (pendingChanges.length === 0) return;
    setConfirmOpen(true);
  }, [pendingChanges]);

  const handleConfirmSave = useCallback(async () => {
    setConfirmOpen(false);
    const changeCount = pendingChanges.length;

    setSaving(true);
    try {
      const result = await applyPendingChangesWithApi(pendingChanges, async (change) => {
        if (change.category === 'mcp') {
          if (change.type === 'add' && (change.entry || change.remoteEntry)) {
            await fetchJson(`/api/agents/${change.agent}/mcps`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ key: change.key, entry: change.entry, remoteEntry: change.remoteEntry }),
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
        const affectedAgents = Array.from(new Set(result.applied.map((c) => c.agent)))
          .map((a) => AGENT_LABELS[a] ?? a);
        toast.success(
          `Applied ${result.applied.length} change${result.applied.length > 1 ? 's' : ''}`,
          {
            description: affectedAgents.length > 0
              ? `Restart ${affectedAgents.join(' & ')} to pick up the changes.`
              : undefined,
            duration: 8000,
          }
        );
      }
    } finally {
      setSaving(false);
    }
  }, [pendingChanges, fetchLiveConfigs, showFeedback]);

  const changeSummaryLines = pendingChanges.map((c) => {
    const prefix = c.category === 'skill' ? '[Skill] ' : '[MCP] ';
    if (c.category === 'plugin') {
      return c.type === 'add'
        ? `+ [Plugin] ${c.key} → ${AGENT_LABELS[c.agent]}`
        : `- [Plugin] ${c.key} from ${AGENT_LABELS[c.agent]}`;
    }
    return c.type === 'add'
      ? `+ ${prefix}${c.key} → ${AGENT_LABELS[c.agent]}`
      : `- ${prefix}${c.key} from ${AGENT_LABELS[c.agent]}`;
  });

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

      const sourceConfig = previewConfigs.find((c) => c.agent === source.agent);
      if (!sourceConfig) return;

      if (source.category === 'mcp') {
        const entry = sourceConfig.mcpServers[source.key];
        const remoteEntry = sourceConfig.remoteMcpServers[source.key];
        if (!entry && !remoteEntry) return;

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
          remoteEntry,
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
                body: JSON.stringify({ key: source.key, entry, remoteEntry }),
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
      if (entry) {
        const sublabel =
          entry.args && entry.args.length > 0
            ? `${entry.command} ${entry.args.join(' ')}`
            : entry.command;
        return { label: parsed.key, sublabel };
      }
      const remoteEntry = config.remoteMcpServers[parsed.key];
      if (remoteEntry) {
        return { label: parsed.key, sublabel: `[remote] ${remoteEntry.transport.toUpperCase()} ${remoteEntry.url}` };
      }
      return null;
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
      <div className="grid gap-4 w-full">
        <div className="flex items-center gap-3 py-8 text-zinc-500 font-medium">
          <Loader2 size={20} className="animate-spin text-zinc-400" /> Loading agent configs...
        </div>
      </div>
    );
  }

  const liveAgentCount = previewConfigs.filter((config) => config.exists).length;
  const totalPortableItems = previewConfigs.reduce(
    (sum, config) =>
      sum +
      Object.keys(config.mcpServers).length +
      Object.keys(config.remoteMcpServers).length +
      splitAgentSkillEntries(config.skills).skills.length +
      splitAgentSkillEntries(config.skills).plugins.length,
    0
  );

  return (
    <div className="grid gap-4 w-full">
      <div className="flex flex-col items-stretch gap-4 pb-4 border-b border-zinc-200/60 lg:flex-row lg:items-end lg:justify-between">
        <div className="grid gap-1">
          <h3 className="text-xl font-semibold tracking-tight text-zinc-900 m-0">Local agents</h3>
          <span className="text-[13px] font-medium text-zinc-500">Drag skills, MCPs, and plugins across columns.</span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-700 shadow-sm">
            <ArrowRightLeft size={12} className="text-zinc-400" /> {liveAgentCount} agents
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-700 shadow-sm">
            <Boxes size={12} className="text-zinc-400" /> {totalPortableItems} items
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-700 shadow-sm">
            <Save size={12} className="text-zinc-400" /> {pendingChanges.length} staged
          </span>
          <button
            className={`inline-flex h-8 items-center gap-2 rounded-lg px-3 text-[13px] font-medium transition-all disabled:opacity-50 ${isEditMode ? 'bg-zinc-900 text-white shadow-sm' : 'border border-zinc-200 bg-white text-zinc-700 shadow-sm hover:bg-zinc-50'}`}
            type="button"
            onClick={() => setIsEditMode((value) => !value)}
            disabled={saving}
          >
            {isEditMode ? <Check size={14} /> : <PencilLine size={14} />}
            {isEditMode ? 'Done editing' : 'Edit items'}
          </button>
          <button
            className={[
              'inline-flex h-8 items-center gap-2 rounded-lg border px-3 text-[13px] font-medium shadow-sm transition-all duration-200 disabled:opacity-50',
              refreshState === 'success'
                ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                : refreshState === 'loading'
                  ? 'border-zinc-300 bg-zinc-100 text-zinc-700'
                  : 'border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50',
            ].join(' ')}
            onClick={() => void handleRefresh()}
            disabled={saving || refreshState === 'loading'}
          >
            {refreshState === 'loading' ? (
              <>
                <Loader2 size={12} className="animate-spin" /> Refreshing
              </>
            ) : refreshState === 'success' ? (
              <>
                <Check size={12} className="animate-[ping_400ms_ease-out_1]" /> Up to date
              </>
            ) : (
              <>
                <RefreshCw size={12} /> Refresh
              </>
            )}
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
        collisionDetection={customCollisionDetection}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="grid grid-cols-1 items-start lg:grid-cols-3 w-full">
          {previewConfigs.map((config, index) => (
            <div 
              key={config.agent} 
              className={`py-10 lg:py-0 lg:px-10 ${index !== 0 ? 'border-t border-zinc-200 lg:border-t-0 lg:border-l' : ''} ${index === 0 ? 'lg:pl-0 lg:pr-10 pt-0' : ''} ${index === previewConfigs.length - 1 ? 'lg:pr-0 lg:pl-10 pb-0' : ''}`}
            >
              <AgentColumn
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
            </div>
          ))}
        </div>

        <DragOverlay modifiers={[snapToPointer]}>
          {overlayData ? (
            <OverlayCard label={overlayData.label} sublabel={overlayData.sublabel} />
          ) : null}
        </DragOverlay>
      </DndContext>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Apply ${pendingChanges.length} change${pendingChanges.length > 1 ? 's' : ''}?`}
        description="The following changes will be written to agent config files:"
        confirmLabel="Apply changes"
        cancelLabel="Cancel"
        variant="default"
        onConfirm={() => void handleConfirmSave()}
      >
        <div className="mt-4 rounded-xl border border-zinc-200 bg-zinc-50 p-4 max-h-64 overflow-y-auto">
          <ul className="space-y-2 font-mono text-xs font-medium text-zinc-700">
            {changeSummaryLines.map((line, i) => (
              <li key={i} className={line.startsWith('+') ? 'text-zinc-900' : 'text-zinc-500 line-through'}>
                {line}
              </li>
            ))}
          </ul>
        </div>
      </ConfirmDialog>
    </div>
  );
}