import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import type { AgentName } from '../../types.js';
import type { AgentMcpEntry } from '../agent/agent-config-service.js';

export interface PluginBundleAgent {
  name: string;
  sourceFormat: 'claude-md' | 'codex-toml';
  content: string;
}

export interface PluginBundleCommand {
  name: string;
  content: string;
}

export interface PluginBundle {
  skills: string[];
  mcps: Record<string, AgentMcpEntry>;
  agents: PluginBundleAgent[];
  commands: PluginBundleCommand[];
}

export function isAgentInstallableOnTarget(target: AgentName): boolean {
  return target === 'claude' || target === 'codex';
}

export function isCommandInstallableOnTarget(target: AgentName): boolean {
  return target === 'claude' || target === 'codex';
}

export async function defaultReadInstalledPluginBundle(installPath: string): Promise<PluginBundle> {
  const skillsDir = path.join(installPath, 'skills');
  let skills: string[] = [];
  try {
    const entries = await readdir(skillsDir, { withFileTypes: true });
    skills = entries
      .filter((entry) => !entry.name.startsWith('.') && entry.isDirectory())
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));
  } catch {
    skills = [];
  }

  let mcps: Record<string, AgentMcpEntry> = {};
  try {
    const mcpSource = await readFile(path.join(installPath, '.mcp.json'), 'utf8');
    const parsed = JSON.parse(mcpSource) as Record<string, { command?: unknown; args?: unknown; env?: unknown }>;
    mcps = Object.fromEntries(
      Object.entries(parsed)
        .filter(([, value]) => typeof value?.command === 'string')
        .map(([key, value]) => [
          key,
          {
            command: String(value.command),
            args: Array.isArray(value.args) ? value.args.map(String) : undefined,
            env:
              value.env && typeof value.env === 'object' && !Array.isArray(value.env)
                ? Object.fromEntries(
                    Object.entries(value.env as Record<string, unknown>).map(([envKey, envValue]) => [
                      envKey,
                      String(envValue),
                    ])
                  )
                : undefined,
          } satisfies AgentMcpEntry,
        ])
    );
  } catch {
    mcps = {};
  }

  const agents: PluginBundleAgent[] = [];
  try {
    const entries = await readdir(path.join(installPath, 'agents'), { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (entry.name.endsWith('.md')) {
        const content = await readFile(path.join(installPath, 'agents', entry.name), 'utf8');
        agents.push({ name: entry.name.replace(/\.md$/, ''), sourceFormat: 'claude-md', content });
      } else if (entry.name.endsWith('.toml')) {
        const content = await readFile(path.join(installPath, 'agents', entry.name), 'utf8');
        agents.push({ name: entry.name.replace(/\.toml$/, ''), sourceFormat: 'codex-toml', content });
      }
    }
    agents.sort((left, right) => left.name.localeCompare(right.name));
  } catch {
    // no agents dir
  }

  const commands: PluginBundleCommand[] = [];
  try {
    const entries = await readdir(path.join(installPath, 'commands'), { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      const content = await readFile(path.join(installPath, 'commands', entry.name), 'utf8');
      commands.push({ name: entry.name.replace(/\.md$/, ''), content });
    }
    commands.sort((left, right) => left.name.localeCompare(right.name));
  } catch {
    // no commands dir
  }

  return { skills, mcps, agents, commands };
}
