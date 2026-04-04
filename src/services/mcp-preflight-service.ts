import { stat } from 'node:fs/promises';
import path from 'node:path';

import type { AgentName } from '../types.js';
import type { AgentMcpEntry } from './agent-config-service.js';
import { findExecutable } from '../system/executables.js';

export interface McpPreflightCheck {
  label: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
}

export interface McpPreflightResult {
  ok: boolean;
  checks: McpPreflightCheck[];
}

export interface McpPreflightService {
  execute(options: {
    cwd: string;
    agent: AgentName;
    key: string;
    entry: AgentMcpEntry;
  }): Promise<McpPreflightResult>;
}

interface McpPreflightDependencies {
  resolveExecutable?: (command: string) => Promise<string | null>;
  pathExists?: (targetPath: string) => Promise<boolean>;
}

const SCRIPT_RUNNERS = new Set(['node', 'nodejs', 'python', 'python3', 'bash', 'sh', 'zsh', 'deno', 'bun']);

export function createMcpPreflightService(
  dependencies: McpPreflightDependencies = {}
): McpPreflightService {
  const resolveExecutable = dependencies.resolveExecutable ?? findExecutable;
  const pathExists = dependencies.pathExists ?? defaultPathExists;

  return {
    async execute(options) {
      const checks: McpPreflightCheck[] = [];
      const resolvedCommand = await resolveExecutable(options.entry.command);

      if (!resolvedCommand) {
        checks.push({
          label: 'Command',
          status: 'error',
          message: `Command "${options.entry.command}" is not available on PATH.`,
        });
        return { ok: false, checks };
      }

      checks.push({
        label: 'Command',
        status: 'ok',
        message: `Command "${options.entry.command}" resolved to ${resolvedCommand}.`,
      });

      if (options.entry.command === 'npx') {
        const nonFlagArg = options.entry.args?.find((arg) => !arg.startsWith('-'));
        if (!nonFlagArg) {
          checks.push({
            label: 'Package',
            status: 'error',
            message: 'npx-based MCP entries must include a package or executable argument.',
          });
        } else {
          checks.push({
            label: 'Package',
            status: 'ok',
            message: `npx will attempt to launch ${nonFlagArg}.`,
          });
        }
      }

      const entrypointPath = resolveEntrypointPath(options.cwd, options.entry);
      if (entrypointPath) {
        const exists = await pathExists(entrypointPath);
        checks.push({
          label: 'Entrypoint',
          status: exists ? 'ok' : 'error',
          message: exists
            ? `Entrypoint script was found: ${entrypointPath}`
            : `Entrypoint script was not found: ${entrypointPath}`,
        });
      }

      return {
        ok: checks.every((check) => check.status !== 'error'),
        checks,
      };
    },
  };
}

function resolveEntrypointPath(cwd: string, entry: AgentMcpEntry): string | null {
  if (!SCRIPT_RUNNERS.has(entry.command)) {
    return null;
  }

  const firstArg = entry.args?.[0];
  if (!firstArg || !looksLikeLocalPath(firstArg)) {
    return null;
  }

  return path.isAbsolute(firstArg) ? firstArg : path.resolve(cwd, firstArg);
}

function looksLikeLocalPath(value: string): boolean {
  return (
    value.startsWith('.') ||
    value.startsWith('/') ||
    value.includes(path.sep) ||
    /\.(cjs|cts|js|json|jsx|mjs|mts|py|sh|ts|tsx)$/i.test(value)
  );
}

async function defaultPathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}
