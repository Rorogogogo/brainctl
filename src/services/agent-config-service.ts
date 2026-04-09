import { copyFile, cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

import { ValidationError } from '../errors.js';
import type { AgentName } from '../types.js';
import {
  createClaudeReader,
  createCodexReader,
  createGeminiReader,
  type AgentConfigReader,
  type AgentLiveConfig,
  type AgentMcpEntry,
} from './sync/agent-reader.js';
import { formatTimestamp } from './sync/agent-writer.js';
import { createMcpPreflightService, type McpPreflightService } from './mcp-preflight-service.js';
import { createSkillPreflightService, type SkillPreflightService } from './skill-preflight-service.js';
import { getSkillDir } from './skill-paths.js';

export type { AgentLiveConfig, AgentMcpEntry, AgentSkillEntry } from './sync/agent-reader.js';
export type { PortableRemoteMcpMetadata } from './sync/agent-reader.js';

export interface AgentConfigService {
  readAll(options: { cwd: string }): Promise<AgentLiveConfig[]>;
  addMcp(options: {
    cwd: string;
    agent: AgentName;
    key: string;
    entry: AgentMcpEntry;
  }): Promise<void>;
  removeMcp(options: {
    cwd: string;
    agent: AgentName;
    key: string;
  }): Promise<void>;
  copySkill(options: {
    sourceAgent: AgentName;
    targetAgent: AgentName;
    skillName: string;
  }): Promise<void>;
  removeSkill(options: {
    agent: AgentName;
    skillName: string;
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
      const { cwd, agent, key, entry } = options;
      const preflight = await mcpPreflightService.execute({ cwd, agent, key, entry });
      const firstError = preflight.checks.find((check) => check.status === 'error');
      if (firstError) {
        throw new ValidationError(
          `MCP "${key}" cannot be added to ${agent}: ${firstError.message}`
        );
      }

      if (agent === 'claude') {
        await mutateClaudeConfig(cwd, (servers) => {
          servers[key] = toClaudeEntry(entry);
        });
      } else if (agent === 'codex') {
        await mutateCodexConfig((servers) => {
          servers[key] = entry;
        });
      } else if (agent === 'gemini') {
        await mutateGeminiConfig(cwd, (servers) => {
          servers[key] = toGeminiEntry(entry);
        });
      }
    },

    async removeMcp(options) {
      const { cwd, agent, key } = options;

      if (agent === 'claude') {
        await mutateClaudeConfig(cwd, (servers) => {
          delete servers[key];
        });
      } else if (agent === 'codex') {
        await mutateCodexConfig((servers) => {
          delete servers[key];
        });
      } else if (agent === 'gemini') {
        await mutateGeminiConfig(cwd, (servers) => {
          delete servers[key];
        });
      }
    },

    async copySkill(options) {
      const { sourceAgent, targetAgent, skillName } = options;
      const preflight = await skillPreflightService.execute({
        sourceAgent,
        targetAgent,
        skillName,
        source: 'local',
      });
      const firstError = preflight.checks.find((check) => check.status === 'error');
      if (firstError) {
        throw new ValidationError(
          `Skill "${skillName}" cannot be copied from ${sourceAgent} to ${targetAgent}: ${firstError.message}`
        );
      }

      const sourceDir = getSkillDir(sourceAgent, skillName);
      const targetDir = getSkillDir(targetAgent, skillName);
      await mkdir(path.dirname(targetDir), { recursive: true });
      await cp(sourceDir, targetDir, { recursive: true });
    },

    async removeSkill(options) {
      const { agent, skillName } = options;
      const skillDir = getSkillDir(agent, skillName);
      await rm(skillDir, { recursive: true, force: true });
    },
  };
}

/* ---- Claude: JSON with projects[cwd].mcpServers ---- */

async function mutateClaudeConfig(
  cwd: string,
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

  const projects = (existing.projects ?? {}) as Record<string, Record<string, unknown>>;
  const projectConfig = projects[cwd] ?? {};
  const servers = (projectConfig.mcpServers ?? {}) as Record<string, unknown>;

  mutate(servers);

  projectConfig.mcpServers = servers;
  projects[cwd] = projectConfig;
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

/* ---- Codex: TOML with [mcp_servers.*] ---- */

async function mutateCodexConfig(
  mutate: (servers: Record<string, AgentMcpEntry>) => void
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
  const current = await readers.codex.read({ cwd: '' });
  const servers = { ...current.mcpServers };

  mutate(servers);

  // Rebuild: preserve non-mcp content + new mcp sections
  const nonMcp = stripCodexMcpSections(existingContent).trim();
  const mcpToml = buildCodexMcpToml(servers);
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

function buildCodexMcpToml(servers: Record<string, AgentMcpEntry>): string {
  const lines: string[] = [];

  for (const [name, entry] of Object.entries(servers)) {
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
