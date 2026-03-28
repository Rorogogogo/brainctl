export type RunAgentName = 'claude' | 'codex';

export interface RunAgentStatus {
  agent: RunAgentName;
  available: boolean;
  command?: string;
}

export interface RunWorkspace {
  skills: string[];
  agents: Record<RunAgentName, RunAgentStatus>;
}

export interface RunDefaults {
  skill: string;
  inputFile: string;
  primaryAgent: RunAgentName;
  fallbackAgent: '' | RunAgentName;
}

export interface RunAgentOption extends RunAgentStatus {}

export interface RunStreamParams {
  skill: string;
  inputFile: string;
  primaryAgent: RunAgentName;
  fallbackAgent?: RunAgentName;
}

const AGENT_ORDER: RunAgentName[] = ['claude', 'codex'];

export function createRunDefaults(workspace: RunWorkspace): RunDefaults {
  const primaryAgent =
    AGENT_ORDER.find((agent) => workspace.agents[agent]?.available) ?? AGENT_ORDER[0];

  return {
    skill: workspace.skills[0] ?? '',
    inputFile: './input.md',
    primaryAgent,
    fallbackAgent: ''
  };
}

export function getRunAgentOptions(workspace: RunWorkspace): RunAgentOption[] {
  return AGENT_ORDER.map((agent) => workspace.agents[agent]);
}

export function getRunFallbackAgentOptions(
  workspace: RunWorkspace,
  primaryAgent: RunAgentName
): RunAgentOption[] {
  return AGENT_ORDER.filter((agent) => agent !== primaryAgent).map((agent) => workspace.agents[agent]);
}

export function normalizeRunFallbackAgent(
  primaryAgent: RunAgentName,
  fallbackAgent: '' | RunAgentName
): '' | RunAgentName {
  if (fallbackAgent === primaryAgent) {
    return '';
  }

  return fallbackAgent;
}

export function buildRunStreamUrl(params: RunStreamParams): string {
  const searchParams = new URLSearchParams({
    skill: params.skill,
    inputFile: params.inputFile,
    primaryAgent: params.primaryAgent
  });

  if (params.fallbackAgent) {
    searchParams.set('fallbackAgent', params.fallbackAgent);
  }

  return `/api/run/stream?${searchParams.toString()}`;
}
