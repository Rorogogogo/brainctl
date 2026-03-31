import { readFile, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

import type { AgentName } from '../../types.js';

export interface AgentMcpEntry {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface AgentSkillEntry {
  name: string;
  source?: string; // e.g. "claude-plugins-official", "local"
}

export interface AgentLiveConfig {
  agent: AgentName;
  configPath: string;
  exists: boolean;
  mcpServers: Record<string, AgentMcpEntry>;
  skills: AgentSkillEntry[];
}

export interface AgentConfigReader {
  read(options: { cwd: string }): Promise<AgentLiveConfig>;
}

export function createClaudeReader(): AgentConfigReader {
  return {
    async read(options) {
      const configPath = path.join(homedir(), '.claude.json');

      try {
        const source = await readFile(configPath, 'utf8');
        const data = JSON.parse(source) as Record<string, unknown>;

        const projects = (data.projects ?? {}) as Record<string, Record<string, unknown>>;
        const projectConfig = projects[options.cwd] ?? {};
        const rawServers = (projectConfig.mcpServers ?? {}) as Record<string, Record<string, unknown>>;

        const mcpServers: Record<string, AgentMcpEntry> = {};
        for (const [name, entry] of Object.entries(rawServers)) {
          mcpServers[name] = {
            command: String(entry.command ?? ''),
            args: Array.isArray(entry.args) ? entry.args.map(String) : undefined,
            env: parseEnvObject(entry.env),
          };
        }

        const skills = await readClaudePlugins();
        return { agent: 'claude', configPath, exists: true, mcpServers, skills };
      } catch {
        const skills = await readClaudePlugins();
        return { agent: 'claude', configPath, exists: false, mcpServers: {}, skills };
      }
    },
  };
}

export function createCodexReader(): AgentConfigReader {
  return {
    async read() {
      const configPath = path.join(homedir(), '.codex', 'config.toml');

      try {
        const source = await readFile(configPath, 'utf8');
        const mcpServers = parseCodexToml(source);
        const skills = await readCodexSkills();
        return { agent: 'codex', configPath, exists: true, mcpServers, skills };
      } catch {
        const skills = await readCodexSkills();
        return { agent: 'codex', configPath, exists: false, mcpServers: {}, skills };
      }
    },
  };
}

export function createGeminiReader(): AgentConfigReader {
  return {
    async read() {
      const configPath = path.join(homedir(), '.gemini', 'settings.json');

      try {
        const source = await readFile(configPath, 'utf8');
        const data = JSON.parse(source) as Record<string, unknown>;
        const rawServers = (data.mcpServers ?? {}) as Record<string, Record<string, unknown>>;

        const mcpServers: Record<string, AgentMcpEntry> = {};
        for (const [name, entry] of Object.entries(rawServers)) {
          mcpServers[name] = {
            command: String(entry.command ?? ''),
            args: Array.isArray(entry.args) ? entry.args.map(String) : undefined,
            env: parseEnvObject(entry.env),
          };
        }

        const skills = await readGeminiSkills();
        return { agent: 'gemini', configPath, exists: true, mcpServers, skills };
      } catch {
        const skills = await readGeminiSkills();
        return { agent: 'gemini', configPath, exists: false, mcpServers: {}, skills };
      }
    },
  };
}

function parseEnvObject(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    result[k] = String(v);
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function parseCodexToml(source: string): Record<string, AgentMcpEntry> {
  const servers: Record<string, AgentMcpEntry> = {};
  const lines = source.split('\n');

  let currentServer: string | null = null;
  let inEnv = false;
  let currentEntry: AgentMcpEntry = { command: '' };
  let currentEnv: Record<string, string> = {};

  for (const line of lines) {
    const trimmed = line.trim();

    // Match [mcp_servers.name.env]
    const envMatch = trimmed.match(/^\[mcp_servers\.([^.]+)\.env\]$/);
    if (envMatch) {
      inEnv = true;
      continue;
    }

    // Match [mcp_servers.name]
    const serverMatch = trimmed.match(/^\[mcp_servers\.([^\].]+)\]$/);
    if (serverMatch) {
      // Save previous server
      if (currentServer) {
        if (Object.keys(currentEnv).length > 0) currentEntry.env = currentEnv;
        servers[currentServer] = currentEntry;
      }

      currentServer = serverMatch[1];
      currentEntry = { command: '' };
      currentEnv = {};
      inEnv = false;
      continue;
    }

    // New non-mcp section — flush current server
    if (/^\[/.test(trimmed) && !/^\[mcp_servers/.test(trimmed)) {
      if (currentServer) {
        if (Object.keys(currentEnv).length > 0) currentEntry.env = currentEnv;
        servers[currentServer] = currentEntry;
        currentServer = null;
        currentEntry = { command: '' };
        currentEnv = {};
      }
      inEnv = false;
      continue;
    }

    // Key-value pair
    const kvMatch = trimmed.match(/^(\w+)\s*=\s*(.+)$/);
    if (!kvMatch || !currentServer) continue;

    const [, key, rawValue] = kvMatch;

    if (inEnv) {
      currentEnv[key] = parseTomlValue(rawValue);
    } else if (key === 'command') {
      currentEntry.command = parseTomlValue(rawValue);
    } else if (key === 'args') {
      currentEntry.args = parseTomlArray(rawValue);
    }
  }

  // Flush last server
  if (currentServer) {
    if (Object.keys(currentEnv).length > 0) currentEntry.env = currentEnv;
    servers[currentServer] = currentEntry;
  }

  return servers;
}

function parseTomlValue(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  return trimmed;
}

function parseTomlArray(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return [];
  const inner = trimmed.slice(1, -1);
  const result: string[] = [];
  const parts = inner.split(',');
  for (const part of parts) {
    const val = parseTomlValue(part.trim());
    if (val.length > 0) result.push(val);
  }
  return result;
}

/* ---- Skill readers ---- */

async function readClaudePlugins(): Promise<AgentSkillEntry[]> {
  try {
    const pluginsPath = path.join(homedir(), '.claude', 'plugins', 'installed_plugins.json');
    const source = await readFile(pluginsPath, 'utf8');
    const data = JSON.parse(source) as { plugins?: Record<string, unknown[]> };
    if (!data.plugins) return [];

    return Object.keys(data.plugins).map((key) => {
      const [name, source] = key.split('@');
      return { name, source };
    });
  } catch {
    return [];
  }
}

async function readCodexSkills(): Promise<AgentSkillEntry[]> {
  try {
    const skillsDir = path.join(homedir(), '.codex', 'skills');
    return await readSkillDirs(skillsDir);
  } catch {
    return [];
  }
}

async function readGeminiSkills(): Promise<AgentSkillEntry[]> {
  try {
    const skillsDir = path.join(homedir(), '.gemini', 'skills');
    return await readSkillDirs(skillsDir);
  } catch {
    return [];
  }
}

/** Shared: read skill directories (Codex and Gemini use the same SKILL.md convention) */
async function readSkillDirs(skillsDir: string): Promise<AgentSkillEntry[]> {
  const entries = await readdir(skillsDir, { withFileTypes: true });
  const skills: AgentSkillEntry[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (entry.isDirectory()) {
      skills.push({ name: entry.name, source: 'local' });
    } else if (entry.isSymbolicLink()) {
      skills.push({ name: entry.name, source: 'linked' });
    }
  }

  return skills;
}
