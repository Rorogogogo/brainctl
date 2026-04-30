import type { AgentName } from '../../types.js';
import { findExecutable } from '../../executables.js';

const SUPPORTED_AGENTS: AgentName[] = ['claude', 'codex', 'gemini'];

const AGENT_COMMANDS: Record<AgentName, string> = {
  claude: 'claude',
  codex: 'codex',
  gemini: 'gemini',
};

export interface AgentAvailability {
  agent: AgentName;
  available: boolean;
  command: string;
  resolvedPath?: string;
}

export interface AgentAvailabilityService {
  getAll(): Promise<Record<AgentName, AgentAvailability>>;
}

export function createAgentAvailabilityService(): AgentAvailabilityService {
  const cache = new Map<AgentName, Promise<AgentAvailability>>();

  const check = (agent: AgentName): Promise<AgentAvailability> => {
    if (!cache.has(agent)) {
      cache.set(agent, checkAvailability(agent));
    }
    return cache.get(agent)!;
  };

  return {
    async getAll() {
      const entries = await Promise.all(
        SUPPORTED_AGENTS.map(async (agent) => [agent, await check(agent)] as const)
      );
      return Object.fromEntries(entries) as Record<AgentName, AgentAvailability>;
    },
  };
}

async function checkAvailability(agent: AgentName): Promise<AgentAvailability> {
  const command = AGENT_COMMANDS[agent];
  const resolvedPath = await findExecutable(command);
  return {
    agent,
    command,
    available: resolvedPath !== null,
    resolvedPath: resolvedPath ?? undefined,
  };
}
