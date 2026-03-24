import { loadConfig } from '../config.js';
import { loadMemory } from '../context/memory.js';
import { createExecutorResolver } from '../executor/resolver.js';
import type { AgentAvailability, ExecutorResolver } from '../executor/resolver.js';
import type { AgentName, MemoryLoadResult } from '../types.js';

export interface StatusResult {
  configPath: string;
  memory: MemoryLoadResult;
  skills: string[];
  mcpCount: number;
  agents: Record<AgentName, AgentAvailability>;
}

export interface StatusService {
  execute(options?: { cwd?: string }): Promise<StatusResult>;
}

export function createStatusService(
  dependencies: { resolver?: ExecutorResolver } = {}
): StatusService {
  const resolver = dependencies.resolver ?? createExecutorResolver();

  return {
    async execute(options = {}): Promise<StatusResult> {
      const cwd = options.cwd ?? process.cwd();
      const config = await loadConfig({ cwd });
      const memory = await loadMemory({ paths: config.memory.paths });
      const agents = await resolver.getAgentAvailability();

      return {
        configPath: config.configPath,
        memory,
        skills: Object.keys(config.skills).sort((left, right) => left.localeCompare(right)),
        mcpCount: Object.keys(config.mcps).length,
        agents
      };
    }
  };
}
