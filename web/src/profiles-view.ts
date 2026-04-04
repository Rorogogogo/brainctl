export interface AgentMcpEntry {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface AgentSkillEntry {
  name: string;
  source?: string;
  kind?: 'skill' | 'plugin';
  pluginSkills?: string[];
  pluginMcps?: string[];
  installPath?: string;
  managed?: boolean;
}

export interface AgentLiveConfig {
  agent: string;
  configPath: string;
  exists: boolean;
  mcpServers: Record<string, AgentMcpEntry>;
  skills: AgentSkillEntry[];
}

export interface PendingChange {
  id: string;
  type: 'add' | 'remove';
  category: 'mcp' | 'skill' | 'plugin';
  agent: string;
  key: string;
  entry?: AgentMcpEntry;
  skillEntry?: AgentSkillEntry;
  pluginEntry?: AgentSkillEntry;
  sourceAgent?: string;
}

export interface PendingChangeFailure {
  change: PendingChange;
  error: string;
}

const AGENT_LABELS: Record<string, string> = {
  claude: 'Claude',
  codex: 'Codex',
  gemini: 'Gemini',
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
    if (!change.entry) {
      return `MCP "${change.key}" is missing the command metadata needed to copy it.`;
    }

    if (targetConfig.mcpServers[change.key]) {
      return `MCP "${change.key}" already exists in ${targetLabel}. Remove it first before copying.`;
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
  const count = entry.pluginSkills?.length ?? 0;

  if (count === 0) {
    return source;
  }

  return `${source} • ${count} skill${count > 1 ? 's' : ''}`;
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
