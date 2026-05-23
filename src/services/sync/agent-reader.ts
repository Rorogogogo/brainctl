import { readFile, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

import type { AgentName } from '../../types.js';
import {
  mergeManagedPluginsIntoSkills,
  readManagedPlugins,
} from './managed-plugin-registry.js';
import { readCodexPlugins, readInstalledPlugins } from './plugin-skill-reader.js';

export interface AgentMcpEntry {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface PortableRemoteMcpMetadata {
  transport: 'http' | 'sse';
  url: string;
  headers?: Record<string, string>;
  env?: Record<string, string>;
}

export interface AgentSkillEntry {
  name: string;
  source?: string; // e.g. "claude-plugins-official", "local"
  kind?: 'skill' | 'plugin';
  /**
   * Where this skill lives in the filesystem hierarchy:
   *   - 'user'    — read from `~/.<agent>/skills/` or a user-installed plugin
   *                 (plugin-owned skills are logically user-scoped because
   *                 plugins are installed under the user's home directory).
   *   - 'project' — read from `<repo>/.claude/skills/` (Claude only).
   */
  scope: 'user' | 'project';
  pluginSkills?: string[];
  pluginMcps?: string[];
  pluginAgents?: string[];
  pluginCommands?: string[];
  installPath?: string;
  managed?: boolean;
}

export interface AgentLiveConfig {
  agent: AgentName;
  configPath: string;
  exists: boolean;
  mcpServers: Record<string, AgentMcpEntry>;
  remoteMcpServers: Record<string, PortableRemoteMcpMetadata>;
  projectMcpServers: Record<string, AgentMcpEntry>;
  projectRemoteMcpServers: Record<string, PortableRemoteMcpMetadata>;
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

        const userServers = (data.mcpServers ?? {}) as Record<string, Record<string, unknown>>;
        const projects = (data.projects ?? {}) as Record<string, Record<string, unknown>>;
        const projectConfig = (projects[options.cwd] ?? {}) as Record<string, unknown>;
        const projectServers = (projectConfig.mcpServers ?? {}) as Record<string, Record<string, unknown>>;

        const mcpServers: Record<string, AgentMcpEntry> = {};
        const remoteMcpServers: Record<string, PortableRemoteMcpMetadata> = {};
        for (const [name, entry] of Object.entries(userServers)) {
          if (isClaudeRemoteEntry(entry)) {
            remoteMcpServers[name] = { transport: entry.type === 'sse' ? 'sse' : 'http', url: String(entry.url ?? ''), headers: parseEnvObject(entry.headers), env: parseEnvObject(entry.env) };
          } else {
            mcpServers[name] = { command: String(entry.command ?? ''), args: Array.isArray(entry.args) ? entry.args.map(String) : undefined, env: parseEnvObject(entry.env) };
          }
        }

        const projectMcpServers: Record<string, AgentMcpEntry> = {};
        const projectRemoteMcpServers: Record<string, PortableRemoteMcpMetadata> = {};
        for (const [name, entry] of Object.entries(projectServers)) {
          if (isClaudeRemoteEntry(entry)) {
            projectRemoteMcpServers[name] = { transport: entry.type === 'sse' ? 'sse' : 'http', url: String(entry.url ?? ''), headers: parseEnvObject(entry.headers), env: parseEnvObject(entry.env) };
          } else {
            projectMcpServers[name] = { command: String(entry.command ?? ''), args: Array.isArray(entry.args) ? entry.args.map(String) : undefined, env: parseEnvObject(entry.env) };
          }
        }

        const skills = await readClaudePlugins();
        const projectSkills = await readClaudeProjectSkills(options.cwd);
        const allSkills = [...skills, ...projectSkills];
        const filtered = filterPluginOwnedMcps({ mcpServers, remoteMcpServers, projectMcpServers, projectRemoteMcpServers, skills: allSkills });
        return {
          agent: 'claude',
          configPath,
          exists: true,
          mcpServers: filtered.mcpServers,
          remoteMcpServers: filtered.remoteMcpServers,
          projectMcpServers: filtered.projectMcpServers,
          projectRemoteMcpServers: filtered.projectRemoteMcpServers,
          skills: allSkills,
        };
      } catch {
        const skills = await readClaudePlugins();
        const projectSkills = await readClaudeProjectSkills(options.cwd);
        return {
          agent: 'claude',
          configPath,
          exists: false,
          mcpServers: {},
          remoteMcpServers: {},
          projectMcpServers: {},
          projectRemoteMcpServers: {},
          skills: [...skills, ...projectSkills],
        };
      }
    },
  };
}

export function createCodexReader(): AgentConfigReader {
  return {
    async read(options) {
      const configPath = path.join(homedir(), '.codex', 'config.toml');
      const { projectMcpServers, projectRemoteMcpServers } = await readBrainctlProjectMcps(options.cwd, 'codex');

      try {
        const source = await readFile(configPath, 'utf8');
        const { mcpServers, remoteMcpServers } = parseCodexToml(source);
        const skills = await readCodexSkills();
        const filtered = filterPluginOwnedMcps({ mcpServers, remoteMcpServers, projectMcpServers, projectRemoteMcpServers, skills });
        return {
          agent: 'codex',
          configPath,
          exists: true,
          mcpServers: filtered.mcpServers,
          remoteMcpServers: filtered.remoteMcpServers,
          projectMcpServers: filtered.projectMcpServers,
          projectRemoteMcpServers: filtered.projectRemoteMcpServers,
          skills,
        };
      } catch {
        const skills = await readCodexSkills();
        return {
          agent: 'codex',
          configPath,
          exists: false,
          mcpServers: {},
          remoteMcpServers: {},
          projectMcpServers,
          projectRemoteMcpServers,
          skills,
        };
      }
    },
  };
}

export function createAntigravityReader(): AgentConfigReader {
  return {
    async read(options) {
      const configPath = path.join(homedir(), '.gemini', 'antigravity-cli', 'mcp_config.json');
      const { projectMcpServers, projectRemoteMcpServers } = await readBrainctlProjectMcps(options.cwd, 'antigravity');

      let rawServers: Record<string, Record<string, unknown>> = {};
      let exists = false;
      try {
        const source = await readFile(configPath, 'utf8');
        const data = JSON.parse(source) as Record<string, unknown>;
        rawServers = (data.mcpServers ?? {}) as Record<string, Record<string, unknown>>;
        exists = true;
      } catch {
        // no global config
      }

      const mcpServers: Record<string, AgentMcpEntry> = {};
      const remoteMcpServers: Record<string, PortableRemoteMcpMetadata> = {};
      for (const [name, entry] of Object.entries(rawServers)) {
        const remoteEntry = toAntigravityRemoteEntry(entry);
        if (remoteEntry) {
          remoteMcpServers[name] = remoteEntry;
          continue;
        }
        mcpServers[name] = { command: String(entry.command ?? ''), args: Array.isArray(entry.args) ? entry.args.map(String) : undefined, env: parseEnvObject(entry.env) };
      }

      const skills = await readAntigravitySkills();
      const filtered = filterPluginOwnedMcps({ mcpServers, remoteMcpServers, projectMcpServers, projectRemoteMcpServers, skills });
      return {
        agent: 'antigravity',
        configPath,
        exists,
        mcpServers: filtered.mcpServers,
        remoteMcpServers: filtered.remoteMcpServers,
        projectMcpServers: filtered.projectMcpServers,
        projectRemoteMcpServers: filtered.projectRemoteMcpServers,
        skills,
      };
    },
  };
}

async function readBrainctlProjectMcps(
  cwd: string,
  agent: 'codex' | 'antigravity'
): Promise<{ projectMcpServers: Record<string, AgentMcpEntry>; projectRemoteMcpServers: Record<string, PortableRemoteMcpMetadata> }> {
  try {
    const filePath = path.join(cwd, '.brainctl', 'project-mcps.json');
    const data = JSON.parse(await readFile(filePath, 'utf8')) as Record<string, unknown>;
    const agentData = (data[agent] ?? {}) as Record<string, unknown>;
    const rawServers = (agentData.mcpServers ?? {}) as Record<string, Record<string, unknown>>;

    const projectMcpServers: Record<string, AgentMcpEntry> = {};
    const projectRemoteMcpServers: Record<string, PortableRemoteMcpMetadata> = {};
    for (const [name, entry] of Object.entries(rawServers)) {
      if (typeof entry.url === 'string' && entry.url) {
        projectRemoteMcpServers[name] = { transport: (entry.transport as 'http' | 'sse') ?? 'http', url: entry.url, headers: parseEnvObject(entry.headers), env: parseEnvObject(entry.env) };
      } else {
        projectMcpServers[name] = { command: String(entry.command ?? ''), args: Array.isArray(entry.args) ? entry.args.map(String) : undefined, env: parseEnvObject(entry.env) };
      }
    }
    return { projectMcpServers, projectRemoteMcpServers };
  } catch {
    return { projectMcpServers: {}, projectRemoteMcpServers: {} };
  }
}

function filterPluginOwnedMcps(options: {
  mcpServers: Record<string, AgentMcpEntry>;
  remoteMcpServers: Record<string, PortableRemoteMcpMetadata>;
  projectMcpServers: Record<string, AgentMcpEntry>;
  projectRemoteMcpServers: Record<string, PortableRemoteMcpMetadata>;
  skills: AgentSkillEntry[];
}): {
  mcpServers: Record<string, AgentMcpEntry>;
  remoteMcpServers: Record<string, PortableRemoteMcpMetadata>;
  projectMcpServers: Record<string, AgentMcpEntry>;
  projectRemoteMcpServers: Record<string, PortableRemoteMcpMetadata>;
} {
  const pluginOwned = new Set(options.skills.flatMap((skill) => skill.pluginMcps ?? []));
  if (pluginOwned.size === 0) {
    return { mcpServers: options.mcpServers, remoteMcpServers: options.remoteMcpServers, projectMcpServers: options.projectMcpServers, projectRemoteMcpServers: options.projectRemoteMcpServers };
  }
  const notOwned = ([key]: [string, unknown]) => !pluginOwned.has(key);
  return {
    mcpServers: Object.fromEntries(Object.entries(options.mcpServers).filter(notOwned)),
    remoteMcpServers: Object.fromEntries(Object.entries(options.remoteMcpServers).filter(notOwned)),
    projectMcpServers: Object.fromEntries(Object.entries(options.projectMcpServers).filter(notOwned)),
    projectRemoteMcpServers: Object.fromEntries(Object.entries(options.projectRemoteMcpServers).filter(notOwned)),
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

function isClaudeRemoteEntry(entry: Record<string, unknown>): boolean {
  if (typeof entry.url !== 'string' || entry.url.trim().length === 0) {
    return false;
  }

  return entry.type === 'http' || entry.type === 'sse' || !('command' in entry);
}

function toAntigravityRemoteEntry(entry: Record<string, unknown>): PortableRemoteMcpMetadata | null {
  if (typeof entry.httpUrl === 'string' && entry.httpUrl.trim().length > 0) {
    return {
      transport: 'http',
      url: entry.httpUrl,
      headers: parseEnvObject(entry.headers),
      env: parseEnvObject(entry.env),
    };
  }

  if (typeof entry.url === 'string' && entry.url.trim().length > 0) {
    return {
      transport: 'sse',
      url: entry.url,
      headers: parseEnvObject(entry.headers),
      env: parseEnvObject(entry.env),
    };
  }

  return null;
}

function parseCodexToml(source: string): {
  mcpServers: Record<string, AgentMcpEntry>;
  remoteMcpServers: Record<string, PortableRemoteMcpMetadata>;
} {
  const mcpServers: Record<string, AgentMcpEntry> = {};
  const remoteMcpServers: Record<string, PortableRemoteMcpMetadata> = {};
  const lines = source.split('\n');

  let currentServer: string | null = null;
  let inEnv = false;
  let currentEntry: AgentMcpEntry = { command: '' };
  let currentEnv: Record<string, string> = {};
  let currentUrl: string | null = null;

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
        flushCodexServer({
          currentServer,
          currentEntry,
          currentEnv,
          currentUrl,
          mcpServers,
          remoteMcpServers,
        });
      }

      currentServer = serverMatch[1];
      currentEntry = { command: '' };
      currentEnv = {};
      currentUrl = null;
      inEnv = false;
      continue;
    }

    // New non-mcp section — flush current server
    if (/^\[/.test(trimmed) && !/^\[mcp_servers/.test(trimmed)) {
      if (currentServer) {
        flushCodexServer({
          currentServer,
          currentEntry,
          currentEnv,
          currentUrl,
          mcpServers,
          remoteMcpServers,
        });
        currentServer = null;
        currentEntry = { command: '' };
        currentEnv = {};
        currentUrl = null;
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
    } else if (key === 'url') {
      currentUrl = parseTomlValue(rawValue);
    } else if (key === 'command') {
      currentEntry.command = parseTomlValue(rawValue);
    } else if (key === 'args') {
      currentEntry.args = parseTomlArray(rawValue);
    }
  }

  // Flush last server
  if (currentServer) {
    flushCodexServer({
      currentServer,
      currentEntry,
      currentEnv,
      currentUrl,
      mcpServers,
      remoteMcpServers,
    });
  }

  return { mcpServers, remoteMcpServers };
}

function flushCodexServer(options: {
  currentServer: string;
  currentEntry: AgentMcpEntry;
  currentEnv: Record<string, string>;
  currentUrl: string | null;
  mcpServers: Record<string, AgentMcpEntry>;
  remoteMcpServers: Record<string, PortableRemoteMcpMetadata>;
}): void {
  const { currentServer, currentEntry, currentEnv, currentUrl, mcpServers, remoteMcpServers } = options;

  if (currentUrl) {
    remoteMcpServers[currentServer] = {
      transport: 'http',
      url: currentUrl,
    };
    return;
  }

  if (Object.keys(currentEnv).length > 0) currentEntry.env = currentEnv;
  mcpServers[currentServer] = currentEntry;
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
  const results: AgentSkillEntry[] = [];

  // Read marketplace plugins
  try {
    const pluginsPath = path.join(homedir(), '.claude', 'plugins', 'installed_plugins.json');
    results.push(...await readInstalledPlugins(pluginsPath));
  } catch {
    // no plugins file
  }

  // Read local skills from ~/.claude/skills/
  try {
    const skillsDir = path.join(homedir(), '.claude', 'skills');
    const localSkills = await readSkillDirs(skillsDir);
    results.push(...localSkills);
  } catch {
    // no skills dir
  }

  return results;
}

async function readCodexSkills(): Promise<AgentSkillEntry[]> {
  const configTomlPath = path.join(homedir(), '.codex', 'config.toml');
  const pluginsCacheDir = path.join(homedir(), '.codex', 'plugins', 'cache');
  const nativePlugins = await readCodexPlugins({ configTomlPath, pluginsCacheDir });
  const managedPlugins = await readManagedPlugins({ agent: 'codex' });

  let localSkills: AgentSkillEntry[] = [];
  try {
    const skillsDir = path.join(homedir(), '.codex', 'skills');
    localSkills = await readSkillDirs(skillsDir);
  } catch {
    localSkills = [];
  }

  const allPlugins = dedupePluginsByName([...managedPlugins, ...nativePlugins]);
  return mergeManagedPluginsIntoSkills(localSkills, allPlugins);
}

function dedupePluginsByName(plugins: AgentSkillEntry[]): AgentSkillEntry[] {
  const seen = new Map<string, AgentSkillEntry>();
  for (const plugin of plugins) {
    if (!seen.has(plugin.name)) seen.set(plugin.name, plugin);
  }
  return Array.from(seen.values());
}

async function readAntigravitySkills(): Promise<AgentSkillEntry[]> {
  try {
    const skillsDir = path.join(homedir(), '.gemini', 'skills');
    const localSkills = await readSkillDirs(skillsDir);
    const managedPlugins = await readManagedPlugins({ agent: 'antigravity' });
    return mergeManagedPluginsIntoSkills(localSkills, managedPlugins);
  } catch {
    return await readManagedPlugins({ agent: 'antigravity' });
  }
}

/** Shared: read skill directories (Codex and Gemini use the same SKILL.md convention) */
async function readSkillDirs(
  skillsDir: string,
  scope: 'user' | 'project' = 'user'
): Promise<AgentSkillEntry[]> {
  const entries = await readdir(skillsDir, { withFileTypes: true });
  const skills: AgentSkillEntry[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const installPath = path.join(skillsDir, entry.name);
    if (entry.isDirectory()) {
      skills.push({ name: entry.name, source: 'local', kind: 'skill', scope, installPath });
    } else if (entry.isSymbolicLink()) {
      skills.push({ name: entry.name, source: 'linked', kind: 'skill', scope, installPath });
    }
  }

  return skills;
}

/**
 * Walk from `cwd` up to the repo root (first ancestor containing `.git`, or
 * the filesystem root) and emit any skills declared in
 * `<ancestor>/.claude/skills/` with `scope: 'project'`.
 *
 * Only Claude reads project-scoped skills per the official docs. Codex and
 * Gemini have no equivalent concept and are intentionally skipped.
 *
 * We dedupe by skill name (closer ancestor wins — Claude itself uses an
 * on-demand discovery model, so capturing the nearest declaration is the
 * predictable choice).
 */
async function readClaudeProjectSkills(cwd: string): Promise<AgentSkillEntry[]> {
  const seen = new Map<string, AgentSkillEntry>();
  let current = path.resolve(cwd);
  const visited = new Set<string>();

  while (!visited.has(current)) {
    visited.add(current);
    const skillsDir = path.join(current, '.claude', 'skills');
    try {
      const entries = await readSkillDirs(skillsDir, 'project');
      for (const entry of entries) {
        if (!seen.has(entry.name)) seen.set(entry.name, entry);
      }
    } catch {
      // no skills dir at this level
    }

    // Stop walk at the first ancestor that looks like a repo root.
    try {
      const gitPath = path.join(current, '.git');
      await stat(gitPath);
      break;
    } catch {
      // not a repo root; continue up
    }

    const parent = path.dirname(current);
    if (parent === current) break; // filesystem root
    current = parent;
  }

  return Array.from(seen.values());
}
