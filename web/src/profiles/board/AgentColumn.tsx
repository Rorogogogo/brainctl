import { useDndContext, useDroppable } from '@dnd-kit/core';
import { Boxes, FileText, Server, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { AgentLogo } from '../../components/agent-brand.js';
import {
  AGENT_LABELS,
  formatPluginSubtitle,
  splitAgentSkillEntries,
  type AgentLiveConfig,
  type AgentMcpEntry,
} from '../profiles-view.js';
import { parseDragId, parseDropId } from './dnd.js';

function getMcpFolderPath(entry: AgentMcpEntry): string | undefined {
  for (const arg of entry.args ?? []) {
    if (arg.startsWith('/')) {
      const i = arg.lastIndexOf('/');
      return i > 0 ? arg.slice(0, i) : '/';
    }
  }
  if (entry.command.startsWith('/')) {
    const i = entry.command.lastIndexOf('/');
    return i > 0 ? entry.command.slice(0, i) : '/';
  }
  return undefined;
}
import { DraggableCard } from './DraggableCard.js';
import { DroppableZone } from './DroppableZone.js';
import { StaticCard } from './StaticCard.js';

function DropAnchorWrapper({ id, children }: { id: string; children?: ReactNode }) {
  const { setNodeRef } = useDroppable({ id });
  return <div ref={setNodeRef} className={children ? "w-full" : "h-0 w-full"}>{children}</div>;
}

function isRemovablePlugin(
  agent: AgentLiveConfig['agent'],
  plugin: ReturnType<typeof splitAgentSkillEntries>['plugins'][number]
): boolean {
  return Boolean(
    plugin.managed ||
      ((agent === 'codex' || agent === 'claude') &&
        typeof plugin.installPath === 'string' &&
        typeof plugin.source === 'string')
  );
}

function DeleteAllButton({
  disabled,
  onClick,
}: {
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      disabled={disabled}
      className="inline-flex h-6 items-center gap-1 rounded-md border border-rose-200 bg-white px-2 text-[11px] font-medium text-rose-700 shadow-sm transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-45"
    >
      <Trash2 size={11} />
      Delete all
    </button>
  );
}

export function AgentColumn({
  config,
  scope,
  pendingAdded,
  pendingRemoved,
  pendingProjectAdded,
  pendingProjectRemoved,
  pendingSkillAdded,
  pendingSkillRemoved,
  pendingPluginAdded,
  pendingPluginRemoved,
  onStagedRemove,
  editable,
}: {
  config: AgentLiveConfig;
  scope: 'global' | 'project';
  pendingAdded: Set<string>;
  pendingRemoved: Set<string>;
  pendingProjectAdded: Set<string>;
  pendingProjectRemoved: Set<string>;
  pendingSkillAdded: Set<string>;
  pendingSkillRemoved: Set<string>;
  pendingPluginAdded: Set<string>;
  pendingPluginRemoved: Set<string>;
  onStagedRemove: (agent: string, category: 'mcp' | 'skill' | 'plugin', key: string, scope: 'global' | 'project') => void;
  editable: boolean;
}) {
  const { setNodeRef } = useDroppable({ id: `${config.agent}:column` });
  const { active, over } = useDndContext();
  const [drawerHover, setDrawerHover] = useState(false);
  const [drawerStatus, setDrawerStatus] = useState<'idle' | 'pending' | 'success' | 'error'>(
    'idle'
  );
  const [drawerError, setDrawerError] = useState<string | null>(null);

  const isHighlighted = () => {
    if (!active || !over) return false;
    const source = parseDragId(active.id as string);
    const target = parseDropId(over.id as string);
    if (!source || !target) return false;
    return target.agent === config.agent && source.agent !== config.agent;
  };

  const highlight = isHighlighted() || drawerHover;

  const activePendingAdded = scope === 'project' ? pendingProjectAdded : pendingAdded;
  const activePendingRemoved = scope === 'project' ? pendingProjectRemoved : pendingRemoved;

  const globalMcpServers = config.mcpServers ?? {};
  const globalRemoteMcpServers = config.remoteMcpServers ?? {};
  const projectMcpServers = config.projectMcpServers ?? {};
  const projectRemoteMcpServers = config.projectRemoteMcpServers ?? {};

  const activeMcpServers = scope === 'project' ? projectMcpServers : globalMcpServers;
  const activeRemoteMcpServers = scope === 'project' ? projectRemoteMcpServers : globalRemoteMcpServers;

  const mcpEntries = [
    ...Object.entries(activeMcpServers).map(([key, entry]) => ({
      key,
      type: 'local' as const,
      sublabel: entry.args && entry.args.length > 0 ? `${entry.command} ${entry.args.join(' ')}` : entry.command,
      folderPath: getMcpFolderPath(entry),
    })),
    ...Object.entries(activeRemoteMcpServers).map(([key, entry]) => ({
      key,
      type: 'remote' as const,
      sublabel: `${entry.transport.toUpperCase()} ${entry.url}`,
      folderPath: undefined,
    })),
  ];
  const { skills: localSkills, plugins } = splitAgentSkillEntries(config.skills);
  const removablePlugins = plugins.filter((plugin) => isRemovablePlugin(config.agent, plugin));

  return (
    <div
      ref={setNodeRef}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('application/x-brainctl-apply')) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
          if (!drawerHover) setDrawerHover(true);
        }
      }}
      onDragLeave={(e) => {
        // ignore inner-element flicker
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setDrawerHover(false);
      }}
      onDrop={async (e) => {
        const raw = e.dataTransfer.getData('application/x-brainctl-apply');
        if (!raw) return;
        e.preventDefault();
        setDrawerHover(false);
        let payload: { profileName: string; type: 'mcp' | 'plugin' | 'skill'; name: string; agent?: string };
        try {
          payload = JSON.parse(raw);
        } catch {
          return;
        }
        if (payload.agent && payload.agent !== config.agent) {
          setDrawerStatus('error');
          setDrawerError(`Item is scoped to ${payload.agent}`);
          setTimeout(() => {
            setDrawerStatus('idle');
            setDrawerError(null);
          }, 2500);
          return;
        }
        setDrawerStatus('pending');
        try {
          const r = await fetch(`/api/profiles/${encodeURIComponent(payload.profileName)}/apply`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              agents: [config.agent],
              items: [{ type: payload.type, name: payload.name }],
              backup: false,
            }),
          });
          if (!r.ok) {
            const data = (await r.json().catch(() => ({}))) as { error?: string };
            throw new Error(data.error ?? `HTTP ${r.status}`);
          }
          setDrawerStatus('success');
          setTimeout(() => setDrawerStatus('idle'), 1500);
        } catch (err) {
          setDrawerStatus('error');
          setDrawerError(err instanceof Error ? err.message : 'Apply failed');
          setTimeout(() => {
            setDrawerStatus('idle');
            setDrawerError(null);
          }, 2500);
        }
      }}
      className={`flex flex-col gap-4 profile-column-${config.agent} transition-all duration-300 rounded-2xl ${
        drawerHover
          ? 'bg-emerald-50 ring-4 ring-emerald-200 shadow-inner p-4 -m-4'
          : highlight
            ? 'bg-zinc-50 ring-4 ring-zinc-200/50 shadow-inner p-4 -m-4'
            : drawerStatus === 'success'
              ? 'bg-emerald-50/40 ring-2 ring-emerald-200'
              : drawerStatus === 'error'
                ? 'bg-rose-50/40 ring-2 ring-rose-200'
                : ''
      }`}
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
        <div className="flex shrink-0 flex-col items-end gap-2">
          <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium shadow-sm ${
            drawerStatus === 'pending'
              ? 'border-amber-200 bg-amber-50 text-amber-700'
              : drawerStatus === 'success'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : drawerStatus === 'error'
                  ? 'border-rose-200 bg-rose-50 text-rose-700'
                  : config.exists
                    ? 'border-zinc-200 bg-zinc-50 text-zinc-700'
                    : 'border-zinc-200 bg-zinc-50 text-zinc-400'
          }`}
          title={drawerError ?? undefined}
        >
          {drawerStatus === 'pending'
            ? 'Applying…'
            : drawerStatus === 'success'
              ? 'Applied'
              : drawerStatus === 'error'
                ? 'Apply failed'
                : config.exists
                  ? 'Active'
                  : 'Offline'}
          </span>
        </div>
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

      <DroppableZone
        id={`${config.agent}:skills`}
        label="Skills"
        icon={<FileText size={16} />}
        count={localSkills.length}
        action={
          editable ? (
            <DeleteAllButton
              disabled={localSkills.length === 0}
              onClick={() => {
                for (const skill of localSkills) {
                  onStagedRemove(config.agent, 'skill', skill.name, 'global');
                }
              }}
            />
          ) : undefined
        }
        hint={
          scope === 'project'
            ? 'Skills are always installed globally — there is no project-scoped location for them.'
            : undefined
        }
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
              onRemove={editable ? () => onStagedRemove(config.agent, 'skill', skill.name, 'global') : undefined}
              editable={editable}
              folderPath={skill.installPath}
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

      <DroppableZone
        id={`${config.agent}:mcps`}
        label="MCP Servers"
        icon={<Server size={16} />}
        count={mcpEntries.length}
        action={
          editable ? (
            <DeleteAllButton
              disabled={mcpEntries.length === 0}
              onClick={() => {
                for (const entry of mcpEntries) {
                  onStagedRemove(config.agent, 'mcp', entry.key, scope);
                }
              }}
            />
          ) : undefined
        }
      >
        {mcpEntries.map(({ key, sublabel, type, folderPath }, index) => {
          const status = activePendingAdded.has(key)
            ? ('added' as const)
            : activePendingRemoved.has(key)
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
              onRemove={editable ? () => onStagedRemove(config.agent, 'mcp', key, scope) : undefined}
              editable={editable}
              folderPath={folderPath}
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
        hint={
          scope === 'project'
            ? 'Plugins are always installed globally — there is no project-scoped location for them.'
            : undefined
        }
        icon={<Boxes size={16} />}
        count={plugins.length}
        action={
          editable ? (
            <DeleteAllButton
              disabled={removablePlugins.length === 0}
              onClick={() => {
                for (const plugin of removablePlugins) {
                  onStagedRemove(config.agent, 'plugin', plugin.name, 'global');
                }
              }}
            />
          ) : undefined
        }
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
                editable && isRemovablePlugin(config.agent, plugin)
                  ? () => onStagedRemove(config.agent, 'plugin', plugin.name, 'global')
                  : undefined
              }
              editable={editable}
              folderPath={plugin.installPath}
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
