export interface AgentMcpEntry {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface AgentRemoteMcpEntry {
  transport: 'http' | 'sse';
  url: string;
  headers?: Record<string, string>;
  env?: Record<string, string>;
}

export interface AgentSkillEntry {
  name: string;
  source?: string;
  kind?: 'skill' | 'plugin';
  pluginSkills?: string[];
  pluginMcps?: string[];
  pluginAgents?: string[];
  pluginCommands?: string[];
  installPath?: string;
  managed?: boolean;
}

export interface AgentLiveConfig {
  agent: string;
  configPath: string;
  exists: boolean;
  mcpServers: Record<string, AgentMcpEntry>;
  remoteMcpServers: Record<string, AgentRemoteMcpEntry>;
  projectMcpServers: Record<string, AgentMcpEntry>;
  projectRemoteMcpServers: Record<string, AgentRemoteMcpEntry>;
  skills: AgentSkillEntry[];
}

export interface PendingChange {
  id: string;
  type: 'add' | 'remove' | 'move';
  category: 'mcp' | 'skill' | 'plugin';
  agent: string;
  scope: 'global' | 'project';
  key: string;
  entry?: AgentMcpEntry;
  remoteEntry?: AgentRemoteMcpEntry;
  skillEntry?: AgentSkillEntry;
  pluginEntry?: AgentSkillEntry;
  sourceAgent?: string;
  // Move-only fields. For type='move', `scope` mirrors `toScope` (so existing
  // dedupe/preview helpers that key on scope keep working for the destination).
  fromScope?: 'global' | 'project';
  toScope?: 'global' | 'project';
  fromProjectPath?: string;
  toProjectPath?: string;
}

export interface PendingChangeFailure {
  change: PendingChange;
  error: string;
}

export const AGENT_LABELS: Record<string, string> = {
  claude: 'Claude',
  codex: 'Codex',
  antigravity: 'Antigravity',
};

export function canStagePendingAddition(
  configs: AgentLiveConfig[],
  change: PendingChange
): string | null {
  if (change.type !== 'add') {
    return null;
  }

  const targetConfig = configs.find((config) => config.agent === change.agent);
  if (!targetConfig) {
    return `Target agent "${change.agent}" is not available in the current view.`;
  }

  const targetLabel = AGENT_LABELS[change.agent] ?? change.agent;

  if (change.category === 'mcp') {
    if (!change.entry && !change.remoteEntry) {
      return `MCP "${change.key}" is missing the command metadata needed to copy it.`;
    }

    const mcpMap = change.scope === 'project' ? targetConfig.projectMcpServers : targetConfig.mcpServers;
    const remoteMcpMap = change.scope === 'project' ? targetConfig.projectRemoteMcpServers : targetConfig.remoteMcpServers;
    if (mcpMap[change.key] || remoteMcpMap[change.key]) {
      const scopeSuffix = change.scope ? ` (${change.scope})` : '';
      return `MCP "${change.key}" already exists in ${targetLabel}${scopeSuffix}. Remove it first before copying.`;
    }

    return null;
  }

  if (change.category === 'plugin') {
    if (!change.pluginEntry || !change.sourceAgent) {
      return `Plugin "${change.key}" is missing the source metadata needed to install it.`;
    }

    if (targetConfig.skills.some((skill) => skill.name === change.key && skill.kind === 'plugin')) {
      return `Plugin "${change.key}" already exists in ${targetLabel}. Remove it first before copying.`;
    }

    return null;
  }

  if (!change.skillEntry || !change.sourceAgent) {
    return `Skill "${change.key}" is missing the source metadata needed to copy it.`;
  }

  if (targetConfig.skills.some((skill) => skill.name === change.key)) {
    return `Skill "${change.key}" already exists in ${targetLabel}. Remove it first before copying.`;
  }

  return null;
}

export function splitAgentSkillEntries(
  entries: AgentSkillEntry[]
): { skills: AgentSkillEntry[]; plugins: AgentSkillEntry[] } {
  const skills: AgentSkillEntry[] = [];
  const plugins: AgentSkillEntry[] = [];

  for (const entry of entries) {
    if (entry.kind === 'plugin') {
      plugins.push(entry);
    } else {
      skills.push(entry);
    }
  }

  return { skills, plugins };
}

export function formatPluginSubtitle(entry: AgentSkillEntry): string {
  const source = entry.source ?? 'managed';
  const skillCount = entry.pluginSkills?.length ?? 0;
  const mcpCount = entry.pluginMcps?.length ?? 0;
  const agentCount = entry.pluginAgents?.length ?? 0;
  const commandCount = entry.pluginCommands?.length ?? 0;

  const parts: string[] = [];
  if (skillCount > 0) parts.push(`${skillCount} skill${skillCount > 1 ? 's' : ''}`);
  if (mcpCount > 0) parts.push(`${mcpCount} MCP${mcpCount > 1 ? 's' : ''}`);
  if (agentCount > 0) parts.push(`${agentCount} agent${agentCount > 1 ? 's' : ''}`);
  if (commandCount > 0) parts.push(`${commandCount} command${commandCount > 1 ? 's' : ''}`);

  if (parts.length === 0) return source;
  return `${source} • ${parts.join(' + ')}`;
}

export async function applyPendingChangesWithApi(
  changes: PendingChange[],
  applyChange: (change: PendingChange) => Promise<void>
): Promise<{ applied: PendingChange[]; failed: PendingChangeFailure[] }> {
  const applied: PendingChange[] = [];
  const failed: PendingChangeFailure[] = [];

  for (const change of changes) {
    try {
      await applyChange(change);
      applied.push(change);
    } catch (error) {
      failed.push({
        change,
        error: error instanceof Error ? error.message : 'Unexpected error',
      });
    }
  }

  return { applied, failed };
}
