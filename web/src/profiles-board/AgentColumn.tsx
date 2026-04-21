import { useDndContext, useDroppable } from '@dnd-kit/core';
import { Boxes, FileText, Server } from 'lucide-react';
import type { ReactNode } from 'react';

import { AgentLogo } from '../agent-brand.js';
import {
  formatPluginSubtitle,
  splitAgentSkillEntries,
  type AgentLiveConfig,
} from '../profiles-view.js';
import { parseDragId, parseDropId } from './dnd.js';
import { DraggableCard } from './DraggableCard.js';
import { DroppableZone } from './DroppableZone.js';
import { StaticCard } from './StaticCard.js';

const AGENT_LABELS: Record<string, string> = {
  claude: 'Claude',
  codex: 'Codex',
  gemini: 'Gemini',
};

function DropAnchorWrapper({ id, children }: { id: string; children?: ReactNode }) {
  const { setNodeRef } = useDroppable({ id });
  return <div ref={setNodeRef} className={children ? "w-full" : "h-0 w-full"}>{children}</div>;
}

export function AgentColumn({
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
