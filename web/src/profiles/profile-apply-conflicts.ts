import { AGENT_LABELS, type AgentLiveConfig } from './profiles-view.js';

export type ProfileApplyAgent = 'claude' | 'codex' | 'antigravity';
export type ProfileApplyItemType = 'mcp' | 'plugin' | 'skill';
export type ProfileApplyConflictResolution = 'replace' | 'keep-both' | 'drop';

export interface ProfileApplySelectableItem {
  type: ProfileApplyItemType;
  name: string;
}

export interface ProfileApplyConflict {
  id: string;
  agent: ProfileApplyAgent;
  agentLabel: string;
  type: ProfileApplyItemType;
  categoryLabel: string;
  name: string;
  suggestedName: string;
  canKeepBoth: boolean;
}

export interface ProfileApplyItemAction {
  agent: ProfileApplyAgent;
  type: ProfileApplyItemType;
  name: string;
  action: ProfileApplyConflictResolution;
  targetName?: string;
}

export function profileApplyItemKey(item: ProfileApplySelectableItem): string {
  return `${item.type}:${item.name}`;
}

export function findProfileApplyConflicts(options: {
  configs: AgentLiveConfig[];
  agents: ProfileApplyAgent[];
  items: ProfileApplySelectableItem[];
  excludedKeys: Set<string>;
}): ProfileApplyConflict[] {
  const conflicts: ProfileApplyConflict[] = [];
  const selectedItems = options.items.filter((item) => !options.excludedKeys.has(profileApplyItemKey(item)));

  for (const agent of options.agents) {
    const config = options.configs.find((entry) => entry.agent === agent);
    if (!config) continue;

    for (const item of selectedItems) {
      if (!profileApplyItemExists(config, item)) continue;

      conflicts.push({
        id: conflictId(agent, item.type, item.name),
        agent,
        agentLabel: AGENT_LABELS[agent] ?? agent,
        type: item.type,
        categoryLabel: item.type === 'mcp' ? 'MCP' : item.type === 'plugin' ? 'Plugin' : 'Skill',
        name: item.name,
        suggestedName: generateProfileApplyCopyName(config, item),
        canKeepBoth: item.type !== 'plugin',
      });
    }
  }

  return conflicts;
}

export function buildProfileApplyItemActions(
  conflicts: ProfileApplyConflict[],
  resolutions: Record<string, ProfileApplyConflictResolution>
): ProfileApplyItemAction[] {
  const actions: ProfileApplyItemAction[] = [];

  for (const conflict of conflicts) {
    const resolution = resolutions[conflict.id] ?? 'replace';
    if (resolution === 'replace') continue;

    if (resolution === 'drop') {
      actions.push({
        agent: conflict.agent,
        type: conflict.type,
        name: conflict.name,
        action: 'drop',
      });
      continue;
    }

    if (!conflict.canKeepBoth) continue;

    actions.push({
      agent: conflict.agent,
      type: conflict.type,
      name: conflict.name,
      action: 'keep-both',
      targetName: conflict.suggestedName,
    });
  }

  return actions;
}

function profileApplyItemExists(
  config: AgentLiveConfig,
  item: ProfileApplySelectableItem
): boolean {
  if (item.type === 'mcp') {
    const local =
      config.agent === 'claude' ? config.projectMcpServers : config.mcpServers;
    const remote =
      config.agent === 'claude' ? config.projectRemoteMcpServers : config.remoteMcpServers;
    return Boolean(local?.[item.name] || remote?.[item.name]);
  }

  if (item.type === 'plugin') {
    return config.skills.some((skill) => skill.name === item.name && skill.kind === 'plugin');
  }

  return config.skills.some((skill) => skill.name === item.name);
}

function generateProfileApplyCopyName(
  config: AgentLiveConfig,
  item: ProfileApplySelectableItem
): string {
  const used = new Set<string>();

  if (item.type === 'mcp') {
    const local =
      config.agent === 'claude' ? config.projectMcpServers : config.mcpServers;
    const remote =
      config.agent === 'claude' ? config.projectRemoteMcpServers : config.remoteMcpServers;
    for (const key of Object.keys(local ?? {})) used.add(key);
    for (const key of Object.keys(remote ?? {})) used.add(key);
  } else if (item.type === 'plugin') {
    for (const skill of config.skills) {
      if (skill.kind === 'plugin') used.add(skill.name);
    }
  } else {
    for (const skill of config.skills) used.add(skill.name);
  }

  const base = `${item.name}-copy`;
  if (!used.has(base)) return base;

  for (let i = 2; ; i += 1) {
    const candidate = `${base}-${i}`;
    if (!used.has(candidate)) return candidate;
  }
}

function conflictId(
  agent: ProfileApplyAgent,
  type: ProfileApplyItemType,
  name: string
): string {
  return `${agent}:${type}:${name}`;
}
