import { stat } from 'node:fs/promises';
import path from 'node:path';

import type { AgentName } from '../types.js';
import type { AgentMcpEntry, PortableRemoteMcpMetadata } from './agent-config-service.js';
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
    entry?: AgentMcpEntry;
    remoteEntry?: PortableRemoteMcpMetadata;
  }): Promise<McpPreflightResult>;
}

interface McpPreflightDependencies {
  resolveExecutable?: (command: string) => Promise<string | null>;
  pathExists?: (targetPath: string) => Promise<boolean>;
}

const ENTRYPOINT_RUNNERS = new Set(['node', 'nodejs', 'python', 'python3', 'bash', 'sh', 'zsh', 'deno', 'bun']);
const SUPPORTED_LOCAL_LAUNCHERS = ['npx', 'uvx', 'node', 'python', 'python3', 'java -jar', 'go run', 'cargo run', 'and local binaries/scripts'];

export function createMcpPreflightService(
  dependencies: McpPreflightDependencies = {}
): McpPreflightService {
  const resolveExecutable = dependencies.resolveExecutable ?? findExecutable;
  const pathExists = dependencies.pathExists ?? defaultPathExists;

  return {
    async execute(options) {
      if (options.remoteEntry) {
        return validateRemoteMcp(options.agent, options.remoteEntry);
      }

      const checks: McpPreflightCheck[] = [];
      if (!options.entry) {
        checks.push({
          label: 'Launcher',
          status: 'error',
          message: 'Missing local MCP command metadata.',
        });
        return { ok: false, checks };
      }

      const launcherCheck = validateLocalLauncher(options.entry);
      checks.push(launcherCheck);
      if (launcherCheck.status === 'error') {
        return { ok: false, checks };
      }

      if (isLocalBinaryPath(options.entry.command)) {
        const commandPath = path.isAbsolute(options.entry.command)
          ? options.entry.command
          : path.resolve(options.cwd, options.entry.command);
        const exists = await pathExists(commandPath);
        checks.push({
          label: 'Command',
          status: exists ? 'ok' : 'error',
          message: exists
            ? `Local MCP command was found: ${commandPath}`
            : `Local MCP command was not found: ${commandPath}`,
        });
        return {
          ok: checks.every((check) => check.status !== 'error'),
          checks,
        };
      }

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

      if (options.entry.command === 'npx' || options.entry.command === 'uvx') {
        const nonFlagArg = options.entry.args?.find((arg) => !arg.startsWith('-'));
        if (!nonFlagArg) {
          checks.push({
            label: 'Package',
            status: 'error',
            message: `${options.entry.command}-based MCP entries must include a package or executable argument.`,
          });
        } else {
          checks.push({
            label: 'Package',
            status: 'ok',
            message: `${options.entry.command} will attempt to launch ${nonFlagArg}.`,
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
  if (entry.command === 'java') {
    const jarIndex = entry.args?.indexOf('-jar') ?? -1;
    const jarPath = jarIndex >= 0 ? entry.args?.[jarIndex + 1] : undefined;
    if (!jarPath || !looksLikeLocalPath(jarPath)) return null;
    return path.isAbsolute(jarPath) ? jarPath : path.resolve(cwd, jarPath);
  }

  if (entry.command === 'go') {
    const runIndex = entry.args?.indexOf('run') ?? -1;
    const runPath = runIndex >= 0 ? entry.args?.[runIndex + 1] : undefined;
    if (!runPath || !looksLikeLocalPath(runPath)) return null;
    return path.isAbsolute(runPath) ? runPath : path.resolve(cwd, runPath);
  }

  if (!ENTRYPOINT_RUNNERS.has(entry.command)) {
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

function validateLocalLauncher(entry: AgentMcpEntry): McpPreflightCheck {
  if (isLocalBinaryPath(entry.command)) {
    return {
      label: 'Launcher',
      status: 'ok',
      message: `Launcher "${entry.command}" is supported for exact MCP copy.`,
    };
  }

  if (entry.command === 'npx' || entry.command === 'uvx' || entry.command === 'node' || entry.command === 'nodejs' || entry.command === 'python' || entry.command === 'python3') {
    return {
      label: 'Launcher',
      status: 'ok',
      message: `Launcher "${entry.command}" is supported for exact MCP copy.`,
    };
  }

  if (entry.command === 'java') {
    const jarIndex = entry.args?.indexOf('-jar') ?? -1;
    const jarPath = jarIndex >= 0 ? entry.args?.[jarIndex + 1] : undefined;
    return jarPath
      ? {
          label: 'Launcher',
          status: 'ok',
          message: 'Launcher "java -jar" is supported for exact MCP copy.',
        }
      : {
          label: 'Launcher',
          status: 'error',
          message: 'Launcher "java" is only supported for exact MCP copy when used as "java -jar <path>".',
        };
  }

  if (entry.command === 'go') {
    const runIndex = entry.args?.indexOf('run') ?? -1;
    const runPath = runIndex >= 0 ? entry.args?.[runIndex + 1] : undefined;
    return runPath
      ? {
          label: 'Launcher',
          status: 'ok',
          message: 'Launcher "go run" is supported for exact MCP copy.',
        }
      : {
          label: 'Launcher',
          status: 'error',
          message: 'Launcher "go" is only supported for exact MCP copy when used as "go run <path>".',
        };
  }

  if (entry.command === 'cargo') {
    return entry.args?.[0] === 'run'
      ? {
          label: 'Launcher',
          status: 'ok',
          message: 'Launcher "cargo run" is supported for exact MCP copy.',
        }
      : {
          label: 'Launcher',
          status: 'error',
          message: 'Launcher "cargo" is only supported for exact MCP copy when used as "cargo run".',
        };
  }

  return {
    label: 'Launcher',
    status: 'error',
    message: `Launcher "${entry.command}" is not supported for exact MCP copy. Supported launchers: ${SUPPORTED_LOCAL_LAUNCHERS.join(', ')}.`,
  };
}

function isLocalBinaryPath(command: string): boolean {
  return command.startsWith('./') || command.startsWith('/') || command.startsWith('.\\');
}

function validateRemoteMcp(agent: AgentName, remoteEntry: PortableRemoteMcpMetadata): McpPreflightResult {
  const checks: McpPreflightCheck[] = [];

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(remoteEntry.url);
  } catch {
    checks.push({
      label: 'Remote URL',
      status: 'error',
      message: `Remote MCP URL is invalid: ${remoteEntry.url}`,
    });
    return { ok: false, checks };
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    checks.push({
      label: 'Remote URL',
      status: 'error',
      message: `Remote MCP URL must use http or https: ${remoteEntry.url}`,
    });
    return { ok: false, checks };
  }

  checks.push({
    label: 'Remote URL',
    status: 'ok',
    message: `Remote MCP URL is valid: ${remoteEntry.url}`,
  });

  if (agent === 'codex' && (remoteEntry.transport !== 'http' || remoteEntry.headers || remoteEntry.env)) {
    checks.push({
      label: 'Remote support',
      status: 'error',
      message: 'Codex remote MCP entries only support a plain HTTP url today; headers and env cannot be preserved exactly.',
    });
  }

  return {
    ok: checks.every((check) => check.status !== 'error'),
    checks,
  };
}

async function defaultPathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}
