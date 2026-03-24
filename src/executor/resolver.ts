import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';

import { AgentNotAvailableError } from '../errors.js';
import type { AgentName } from '../types.js';
import { ClaudeExecutor } from './claude.js';
import { CodexExecutor } from './codex.js';
import type { Executor } from './types.js';

const SUPPORTED_AGENTS: AgentName[] = ['claude', 'codex'];

const AGENT_COMMANDS: Record<AgentName, string> = {
  claude: 'claude',
  codex: 'codex'
};

export interface AgentAvailability {
  agent: AgentName;
  available: boolean;
  command: string;
  resolvedPath?: string;
}

export interface ExecutorResolver {
  resolveExecutor(agentName: AgentName): Promise<Executor>;
  getAgentAvailability(): Promise<Record<AgentName, AgentAvailability>>;
}

class DefaultExecutorResolver implements ExecutorResolver {
  private readonly availabilityCache = new Map<AgentName, Promise<AgentAvailability>>();
  private readonly executorCache = new Map<AgentName, Executor>();

  public async resolveExecutor(agentName: AgentName): Promise<Executor> {
    const availability = await this.getAvailabilityForAgent(agentName);

    if (!availability.available) {
      throw new AgentNotAvailableError(
        `Agent "${agentName}" is not available on PATH.`
      );
    }

    if (!this.executorCache.has(agentName)) {
      this.executorCache.set(agentName, createExecutor(agentName));
    }

    return this.executorCache.get(agentName)!;
  }

  public async getAgentAvailability(): Promise<Record<AgentName, AgentAvailability>> {
    const checks = await Promise.all(
      SUPPORTED_AGENTS.map(async (agentName) => [
        agentName,
        await this.getAvailabilityForAgent(agentName)
      ] as const)
    );

    return Object.fromEntries(checks) as Record<AgentName, AgentAvailability>;
  }

  private async getAvailabilityForAgent(agentName: AgentName): Promise<AgentAvailability> {
    if (!this.availabilityCache.has(agentName)) {
      this.availabilityCache.set(agentName, checkAvailability(agentName));
    }

    return await this.availabilityCache.get(agentName)!;
  }
}

export function createExecutorResolver(): ExecutorResolver {
  return new DefaultExecutorResolver();
}

function createExecutor(agentName: AgentName): Executor {
  switch (agentName) {
    case 'claude':
      return new ClaudeExecutor();
    case 'codex':
      return new CodexExecutor();
  }
}

async function checkAvailability(agentName: AgentName): Promise<AgentAvailability> {
  const command = AGENT_COMMANDS[agentName];
  const resolvedPath = await findExecutable(command);

  return {
    agent: agentName,
    command,
    available: resolvedPath !== null,
    resolvedPath: resolvedPath ?? undefined
  };
}

async function findExecutable(command: string): Promise<string | null> {
  if (command.includes(path.sep)) {
    return (await isExecutable(command)) ? command : null;
  }

  const pathEntries = (process.env.PATH ?? '')
    .split(path.delimiter)
    .filter((entry) => entry.length > 0);
  const extensions =
    process.platform === 'win32'
      ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM')
          .split(';')
          .filter((entry) => entry.length > 0)
      : [''];

  for (const pathEntry of pathEntries) {
    for (const extension of extensions) {
      const candidate =
        process.platform === 'win32' &&
        extension.length > 0 &&
        !command.toLowerCase().endsWith(extension.toLowerCase())
          ? path.join(pathEntry, `${command}${extension}`)
          : path.join(pathEntry, command);

      if (await isExecutable(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

async function isExecutable(filePath: string): Promise<boolean> {
  try {
    await access(
      filePath,
      process.platform === 'win32' ? constants.F_OK : constants.X_OK
    );
    return true;
  } catch {
    return false;
  }
}
