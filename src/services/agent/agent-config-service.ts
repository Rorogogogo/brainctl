import { copyFile, cp, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

import { ValidationError } from '../../errors.js';
import type { AgentName } from '../../types.js';
import {
  createClaudeReader,
  createCodexReader,
  createGeminiReader,
  type AgentConfigReader,
  type AgentLiveConfig,
  type AgentMcpEntry,
  type PortableRemoteMcpMetadata,
} from '../sync/agent-reader.js';
import { formatTimestamp } from '../sync/agent-writer.js';
import { createMcpPreflightService, type McpPreflightService } from '../platform/mcp-preflight-service.js';
import { createSkillPreflightService, type SkillPreflightService } from '../plugin/skill-preflight-service.js';
import { getSkillDir } from '../plugin/skill-paths.js';

export type { AgentLiveConfig, AgentMcpEntry, AgentSkillEntry } from '../sync/agent-reader.js';
export type { PortableRemoteMcpMetadata } from '../sync/agent-reader.js';

export interface AgentConfigService {
  readAll(options: { cwd: string }): Promise<AgentLiveConfig[]>;
  addMcp(options: {
    cwd: string;
    agent: AgentName;
    key: string;
    entry?: AgentMcpEntry;
    remoteEntry?: PortableRemoteMcpMetadata;
    scope?: 'global' | 'project';
  }): Promise<void>;
  removeMcp(options: {
    cwd: string;
    agent: AgentName;
    key: string;
    scope?: 'global' | 'project';
  }): Promise<void>;
  moveMcpScope(options: {
    cwd: string;
    agent: AgentName;
    key: string;
    fromScope: 'global' | 'project';
    toScope: 'global' | 'project';
    fromProjectPath?: string;
    toProjectPath?: string;
  }): Promise<void>;
  listClaudeProjects(): Promise<string[]>;
  copySkill(options: {
    sourceAgent: AgentName;
    targetAgent: AgentName;
    skillName: string;
    sourceScope?: 'user' | 'project';
    targetScope?: 'user' | 'project';
    sourceCwd?: string;
    targetCwd?: string;
  }): Promise<void>;
  removeSkill(options: {
    agent: AgentName;
    skillName: string;
    scope?: 'user' | 'project';
    cwd?: string;
  }): Promise<void>;
  moveSkillScope(options: {
    cwd: string;
    agent: AgentName;
    skillName: string;
    fromScope: 'user' | 'project';
    toScope: 'user' | 'project';
    fromProjectPath?: string;
    toProjectPath?: string;
  }): Promise<void>;
}

interface AgentConfigServiceDependencies {
  mcpPreflightService?: McpPreflightService;
  skillPreflightService?: SkillPreflightService;
}

const readers: Record<AgentName, AgentConfigReader> = {
  claude: createClaudeReader(),
  codex: createCodexReader(),
  gemini: createGeminiReader(),
};

export function createAgentConfigService(
  dependencies: AgentConfigServiceDependencies = {}
): AgentConfigService {
  const mcpPreflightService = dependencies.mcpPreflightService ?? createMcpPreflightService();
  const skillPreflightService = dependencies.skillPreflightService ?? createSkillPreflightService();

  return {
    async readAll(options) {
      const results = await Promise.all([
        readers.claude.read(options),
        readers.codex.read(options),
        readers.gemini.read(options),
      ]);
      return results;
    },

    async addMcp(options) {
      const { cwd, agent, key, entry, remoteEntry, scope = 'global' } = options;
      const preflight = await mcpPreflightService.execute({ cwd, agent, key, entry, remoteEntry });
      const firstError = preflight.checks.find((check) => check.status === 'error');
      if (firstError) {
        throw new ValidationError(
          `MCP "${key}" cannot be added to ${agent}: ${firstError.message}`
        );
      }

      if (agent === 'claude') {
        await mutateClaudeConfig(cwd, scope, (servers) => {
          servers[key] = remoteEntry ? toClaudeRemoteEntry(remoteEntry) : toClaudeEntry(entry!);
        });
      } else if (agent === 'codex') {
        if (scope === 'project') {
          await mutateBrainctlProjectMcps(cwd, 'codex', (state) => {
            delete state.mcpServers[key];
            delete state.remoteMcpServers[key];
            if (remoteEntry) { state.remoteMcpServers[key] = remoteEntry; } else { state.mcpServers[key] = entry!; }
          });
        } else {
          await mutateCodexConfig(cwd, (state) => {
            delete state.mcpServers[key];
            delete state.remoteMcpServers[key];
            if (remoteEntry) { state.remoteMcpServers[key] = remoteEntry; } else { state.mcpServers[key] = entry!; }
          });
        }
      } else if (agent === 'gemini') {
        if (scope === 'project') {
          await mutateBrainctlProjectMcps(cwd, 'gemini', (state) => {
            delete state.mcpServers[key];
            delete state.remoteMcpServers[key];
            if (remoteEntry) { state.remoteMcpServers[key] = remoteEntry; } else { state.mcpServers[key] = entry!; }
          });
        } else {
          await mutateGeminiConfig(cwd, (servers) => {
            servers[key] = remoteEntry ? toGeminiRemoteEntry(remoteEntry) : toGeminiEntry(entry!);
          });
        }
      }
    },

    async removeMcp(options) {
      const { cwd, agent, key, scope = 'global' } = options;

      if (agent === 'claude') {
        await mutateClaudeConfig(cwd, scope, (servers) => { delete servers[key]; });
      } else if (agent === 'codex') {
        if (scope === 'project') {
          await mutateBrainctlProjectMcps(cwd, 'codex', (state) => { delete state.mcpServers[key]; delete state.remoteMcpServers[key]; });
        } else {
          await mutateCodexConfig(cwd, (state) => { delete state.mcpServers[key]; delete state.remoteMcpServers[key]; });
        }
      } else if (agent === 'gemini') {
        if (scope === 'project') {
          await mutateBrainctlProjectMcps(cwd, 'gemini', (state) => { delete state.mcpServers[key]; delete state.remoteMcpServers[key]; });
        } else {
          await mutateGeminiConfig(cwd, (servers) => { delete servers[key]; });
        }
      }
    },

    async moveMcpScope(options) {
      const { cwd, agent, key, fromScope, toScope, fromProjectPath, toProjectPath } = options;
      const fromCwd = fromScope === 'project' ? (fromProjectPath ?? cwd) : cwd;
      const toCwd = toScope === 'project' ? (toProjectPath ?? cwd) : cwd;
      if (fromScope === toScope && fromCwd === toCwd) return;

      if (agent === 'claude') {
        await moveClaudeMcpScope(key, fromScope, toScope, fromCwd, toCwd);
        return;
      }

      // Codex + Gemini: read live entry from source scope, then add to target, remove from source.
      // Both already route 'project' to .brainctl/project-mcps.json via add/removeMcp.
      const live = await readers[agent].read({ cwd: fromCwd });
      const sourceLocal = fromScope === 'project' ? (live.projectMcpServers ?? {}) : live.mcpServers;
      const sourceRemote =
        fromScope === 'project' ? (live.projectRemoteMcpServers ?? {}) : live.remoteMcpServers;
      const entry = sourceLocal[key];
      const remoteEntry = sourceRemote[key];
      if (!entry && !remoteEntry) {
        throw new ValidationError(
          `MCP "${key}" not found in ${agent} ${fromScope} scope; cannot move.`
        );
      }
      await this.addMcp({ cwd: toCwd, agent, key, entry, remoteEntry, scope: toScope });
      await this.removeMcp({ cwd: fromCwd, agent, key, scope: fromScope });
    },

    async listClaudeProjects() {
      const configPath = path.join(homedir(), '.claude.json');
      try {
        const raw = JSON.parse(await readFile(configPath, 'utf8')) as Record<string, unknown>;
        const projects = (raw.projects ?? {}) as Record<string, unknown>;
        return Object.keys(projects).sort();
      } catch {
        return [];
      }
    },

    async copySkill(options) {
      const { sourceAgent, targetAgent, skillName } = options;
      const sourceScope = options.sourceScope ?? 'user';
      const targetScope = options.targetScope ?? 'user';
      const preflight = await skillPreflightService.execute({
        sourceAgent,
        targetAgent,
        skillName,
        source: 'local',
        sourceScope,
        sourceCwd: options.sourceCwd,
      });
      const firstError = preflight.checks.find((check) => check.status === 'error');
      if (firstError) {
        throw new ValidationError(
          `Skill "${skillName}" cannot be copied from ${sourceAgent} to ${targetAgent}: ${firstError.message}`
        );
      }

      const sourceDir = getSkillDir(sourceAgent, skillName, sourceScope, options.sourceCwd);
      const targetDir = getSkillDir(targetAgent, skillName, targetScope, options.targetCwd);
      await mkdir(path.dirname(targetDir), { recursive: true });
      await cp(sourceDir, targetDir, { recursive: true });
    },

    async removeSkill(options) {
      const { agent, skillName } = options;
      const scope = options.scope ?? 'user';
      const skillDir = getSkillDir(agent, skillName, scope, options.cwd);
      await rm(skillDir, { recursive: true, force: true });
    },

    async moveSkillScope(options) {
      const { cwd, agent, skillName, fromScope, toScope, fromProjectPath, toProjectPath } = options;
      if (agent !== 'claude') {
        throw new ValidationError(
          `Skill scope changes are only supported for Claude (codex/gemini have no project-scoped skills).`
        );
      }
      const fromCwd = fromScope === 'project' ? (fromProjectPath ?? cwd) : cwd;
      const toCwd = toScope === 'project' ? (toProjectPath ?? cwd) : cwd;
      if (fromScope === toScope && fromCwd === toCwd) return;

      const fromDir = getSkillDir(agent, skillName, fromScope, fromCwd);
      const toDir = getSkillDir(agent, skillName, toScope, toCwd);

      try {
        await stat(fromDir);
      } catch {
        // Idempotent: if the source is already gone but the destination
        // exists, treat the move as already done.
        try {
          await stat(toDir);
          return;
        } catch {
          throw new ValidationError(
            `Skill "${skillName}" not found in Claude ${fromScope} scope at ${fromDir}.`
          );
        }
      }

      await mkdir(path.dirname(toDir), { recursive: true });
      // If the destination already exists, replace it (idempotent overwrite).
      await rm(toDir, { recursive: true, force: true });
      await cp(fromDir, toDir, { recursive: true });
      await rm(fromDir, { recursive: true, force: true });
    },
  };
}

/* ---- Claude: JSON with projects[cwd].mcpServers ---- */

async function mutateClaudeConfig(
  cwd: string,
  scope: 'global' | 'project',
  mutate: (servers: Record<string, unknown>) => void
): Promise<void> {
  const configPath = path.join(homedir(), '.claude.json');
  let existing: Record<string, unknown> = {};

  try {
    existing = JSON.parse(await readFile(configPath, 'utf8')) as Record<string, unknown>;
    await backupFile(configPath);
  } catch {
    // fresh config
  }

  if (scope === 'global') {
    const servers = (existing.mcpServers ?? {}) as Record<string, unknown>;
    mutate(servers);
    existing.mcpServers = servers;
  } else {
    const projects = (existing.projects ?? {}) as Record<string, Record<string, unknown>>;
    const projectConfig = (projects[cwd] ?? {}) as Record<string, unknown>;
    const servers = (projectConfig.mcpServers ?? {}) as Record<string, unknown>;
    mutate(servers);
    projectConfig.mcpServers = servers;
    projects[cwd] = projectConfig;
    existing.projects = projects;
  }

  await atomicWriteJson(configPath, existing);
}

async function moveClaudeMcpScope(
  key: string,
  fromScope: 'global' | 'project',
  toScope: 'global' | 'project',
  fromCwd: string,
  toCwd: string
): Promise<void> {
  const configPath = path.join(homedir(), '.claude.json');
  let existing: Record<string, unknown>;
  try {
    existing = JSON.parse(await readFile(configPath, 'utf8')) as Record<string, unknown>;
  } catch {
    throw new ValidationError(
      `Cannot move MCP "${key}": ~/.claude.json does not exist or is unreadable.`
    );
  }
  await backupFile(configPath);

  const globalServers = (existing.mcpServers ?? {}) as Record<string, unknown>;
  const projects = (existing.projects ?? {}) as Record<string, Record<string, unknown>>;

  const getProjectServers = (cwd: string): Record<string, unknown> => {
    const projectConfig = (projects[cwd] ?? {}) as Record<string, unknown>;
    return (projectConfig.mcpServers ?? {}) as Record<string, unknown>;
  };
  const setProjectServers = (cwd: string, servers: Record<string, unknown>): void => {
    const projectConfig = (projects[cwd] ?? {}) as Record<string, unknown>;
    projectConfig.mcpServers = servers;
    projects[cwd] = projectConfig;
  };

  const source = fromScope === 'project' ? getProjectServers(fromCwd) : globalServers;
  const target = toScope === 'project' ? getProjectServers(toCwd) : globalServers;

  if (!(key in source)) {
    throw new ValidationError(
      `MCP "${key}" not found in Claude ${fromScope} scope${fromScope === 'project' ? ` (${fromCwd})` : ''}; cannot move.`
    );
  }
  const rawEntry = source[key];
  target[key] = rawEntry;
  delete source[key];

  existing.mcpServers = globalServers;
  if (fromScope === 'project') setProjectServers(fromCwd, source);
  if (toScope === 'project') setProjectServers(toCwd, target);
  existing.projects = projects;

  await atomicWriteJson(configPath, existing);
}

function toClaudeEntry(entry: AgentMcpEntry): Record<string, unknown> {
  return {
    type: 'stdio',
    command: entry.command,
    args: entry.args ?? [],
    ...(entry.env ? { env: entry.env } : {}),
  };
}

function toClaudeRemoteEntry(entry: PortableRemoteMcpMetadata): Record<string, unknown> {
  return {
    type: entry.transport === 'sse' ? 'sse' : 'http',
    url: entry.url,
    ...(entry.headers ? { headers: entry.headers } : {}),
  };
}

/* ---- Codex: TOML with [mcp_servers.*] ---- */

async function mutateCodexConfig(
  cwd: string,
  mutate: (state: {
    mcpServers: Record<string, AgentMcpEntry>;
    remoteMcpServers: Record<string, PortableRemoteMcpMetadata>;
  }) => void
): Promise<void> {
  const configPath = path.join(homedir(), '.codex', 'config.toml');
  let existingContent = '';

  try {
    existingContent = await readFile(configPath, 'utf8');
    await backupFile(configPath);
  } catch {
    // fresh config
  }

  // Read current servers via reader
  const current = await readers.codex.read({ cwd });
  const state = {
    mcpServers: { ...current.mcpServers },
    remoteMcpServers: { ...current.remoteMcpServers },
  };

  mutate(state);

  // Rebuild: preserve non-mcp content + new mcp sections
  const nonMcp = stripCodexMcpSections(existingContent).trim();
  const mcpToml = buildCodexMcpToml(state);
  const final = nonMcp.length > 0 ? `${nonMcp}\n\n${mcpToml}` : mcpToml;

  await mkdir(path.dirname(configPath), { recursive: true });
  await atomicWrite(configPath, final + '\n');
}

function stripCodexMcpSections(content: string): string {
  const lines = content.split('\n');
  const result: string[] = [];
  let inMcp = false;

  for (const line of lines) {
    if (/^\[mcp_servers[\].]/.test(line)) {
      inMcp = true;
      continue;
    }
    if (inMcp && /^\[/.test(line) && !/^\[mcp_servers[\].]/.test(line)) {
      inMcp = false;
    }
    if (!inMcp) result.push(line);
  }

  return result.join('\n');
}

function buildCodexMcpToml(state: {
  mcpServers: Record<string, AgentMcpEntry>;
  remoteMcpServers: Record<string, PortableRemoteMcpMetadata>;
}): string {
  const lines: string[] = [];

  for (const [name, entry] of Object.entries(state.mcpServers)) {
    lines.push(`[mcp_servers.${name}]`);
    lines.push(`command = ${tomlStr(entry.command)}`);
    if (entry.args && entry.args.length > 0) {
      lines.push(`args = [${entry.args.map(tomlStr).join(', ')}]`);
    }
    if (entry.env && Object.keys(entry.env).length > 0) {
      lines.push('');
      lines.push(`[mcp_servers.${name}.env]`);
      for (const [k, v] of Object.entries(entry.env)) {
        lines.push(`${k} = ${tomlStr(v)}`);
      }
    }
    lines.push('');
  }

  for (const [name, entry] of Object.entries(state.remoteMcpServers)) {
    lines.push(`[mcp_servers.${name}]`);
    lines.push(`url = ${tomlStr(entry.url)}`);
    lines.push('');
  }

  return lines.join('\n').trim();
}

function tomlStr(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/* ---- Gemini: JSON with mcpServers ---- */

async function mutateGeminiConfig(
  _cwd: string,
  mutate: (servers: Record<string, unknown>) => void
): Promise<void> {
  const configPath = path.join(homedir(), '.gemini', 'settings.json');

  let existing: Record<string, unknown> = {};
  try {
    existing = JSON.parse(await readFile(configPath, 'utf8')) as Record<string, unknown>;
    await backupFile(configPath);
  } catch {
    // fresh config
  }

  const servers = (existing.mcpServers ?? {}) as Record<string, unknown>;
  mutate(servers);
  existing.mcpServers = servers;

  await mkdir(path.dirname(configPath), { recursive: true });
  await atomicWriteJson(configPath, existing);
}

function toGeminiEntry(entry: AgentMcpEntry): Record<string, unknown> {
  return {
    command: entry.command,
    args: entry.args ?? [],
    ...(entry.env ? { env: entry.env } : {}),
  };
}

function toGeminiRemoteEntry(entry: PortableRemoteMcpMetadata): Record<string, unknown> {
  return {
    ...(entry.transport === 'http' ? { httpUrl: entry.url } : { url: entry.url }),
    ...(entry.headers ? { headers: entry.headers } : {}),
    ...(entry.env ? { env: entry.env } : {}),
  };
}

/* ---- Brainctl project MCPs: .brainctl/project-mcps.json ---- */

async function mutateBrainctlProjectMcps(
  cwd: string,
  agent: 'codex' | 'gemini',
  mutate: (state: { mcpServers: Record<string, AgentMcpEntry>; remoteMcpServers: Record<string, PortableRemoteMcpMetadata> }) => void
): Promise<void> {
  const filePath = path.join(cwd, '.brainctl', 'project-mcps.json');
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(await readFile(filePath, 'utf8')) as Record<string, unknown>;
  } catch {
    // fresh file
  }

  const agentData = (data[agent] ?? {}) as Record<string, unknown>;
  const rawServers = (agentData.mcpServers ?? {}) as Record<string, Record<string, unknown>>;

  const mcpServers: Record<string, AgentMcpEntry> = {};
  const remoteMcpServers: Record<string, PortableRemoteMcpMetadata> = {};
  for (const [name, entry] of Object.entries(rawServers)) {
    if (typeof entry.url === 'string' && entry.url) {
      remoteMcpServers[name] = { transport: (entry.transport as 'http' | 'sse') ?? 'http', url: entry.url };
    } else {
      mcpServers[name] = { command: String(entry.command ?? ''), args: Array.isArray(entry.args) ? entry.args.map(String) : undefined };
    }
  }

  mutate({ mcpServers, remoteMcpServers });

  const newServers: Record<string, unknown> = {};
  for (const [name, entry] of Object.entries(mcpServers)) {
    newServers[name] = { command: entry.command, ...(entry.args ? { args: entry.args } : {}), ...(entry.env ? { env: entry.env } : {}) };
  }
  for (const [name, entry] of Object.entries(remoteMcpServers)) {
    newServers[name] = { transport: entry.transport, url: entry.url };
  }
  data[agent] = { mcpServers: newServers };

  await mkdir(path.join(cwd, '.brainctl'), { recursive: true });
  await atomicWriteJson(filePath, data);
}

/* ---- Shared helpers ---- */

async function backupFile(filePath: string): Promise<void> {
  const backupPath = `${filePath}.bak.${formatTimestamp()}`;
  try {
    await copyFile(filePath, backupPath);
  } catch {
    // File may not exist yet
  }
}

async function atomicWriteJson(filePath: string, data: unknown): Promise<void> {
  await atomicWrite(filePath, JSON.stringify(data, null, 2) + '\n');
}

async function atomicWrite(filePath: string, content: string): Promise<void> {
  const tmpPath = `${filePath}.tmp.${Date.now()}`;
  await writeFile(tmpPath, content, 'utf8');
  await rename(tmpPath, filePath);
}
