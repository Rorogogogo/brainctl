import { readdir, readFile, writeFile, mkdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';

import YAML from 'yaml';

import { ProfileError, ProfileNotFoundError } from '../errors.js';
import type { AgentName, BrainctlMetaConfig, McpRuntime, McpServerConfig, ProfileConfig, SkillConfig } from '../types.js';

const VALID_RUNTIMES = new Set<McpRuntime>(['node', 'python', 'java', 'go', 'rust', 'binary']);

const BRAINCTL_DIR = '.brainctl';
const PROFILES_DIR = '.brainctl/profiles';
const META_CONFIG = '.brainctl/config.yaml';

export interface ProfileService {
  list(options?: { cwd?: string }): Promise<{ profiles: string[]; activeProfile: string | null }>;
  get(options: { cwd?: string; name: string }): Promise<ProfileConfig>;
  create(options: { cwd?: string; name: string; description?: string }): Promise<{ profilePath: string }>;
  update(options: { cwd?: string; name: string; config: ProfileConfig }): Promise<void>;
  delete(options: { cwd?: string; name: string }): Promise<void>;
  use(options: { cwd?: string; name: string }): Promise<{ previousProfile: string | null }>;
  getMetaConfig(options?: { cwd?: string }): Promise<BrainctlMetaConfig>;
}

export function createProfileService(): ProfileService {
  return {
    async list(options = {}) {
      const cwd = options.cwd ?? process.cwd();
      const profilesDir = path.join(cwd, PROFILES_DIR);

      let files: string[] = [];
      try {
        const entries = await readdir(profilesDir);
        files = entries
          .filter((f) => f.endsWith('.yaml'))
          .map((f) => f.replace(/\.yaml$/, ''))
          .sort();
      } catch {
        // No profiles directory yet
      }

      const meta = await loadMetaConfig(cwd);
      return {
        profiles: files,
        activeProfile: meta.active_profile || null,
      };
    },

    async get(options) {
      const cwd = options.cwd ?? process.cwd();
      const profilePath = path.join(cwd, PROFILES_DIR, `${options.name}.yaml`);

      let source: string;
      try {
        source = await readFile(profilePath, 'utf8');
      } catch {
        throw new ProfileNotFoundError(`Profile "${options.name}" not found at ${profilePath}`);
      }

      return parseProfile(source, options.name);
    },

    async create(options) {
      const cwd = options.cwd ?? process.cwd();
      const profilesDir = path.join(cwd, PROFILES_DIR);
      const profilePath = path.join(profilesDir, `${options.name}.yaml`);

      if (await pathExists(profilePath)) {
        throw new ProfileError(`Profile "${options.name}" already exists.`);
      }

      const scaffold: Record<string, unknown> = {
        name: options.name,
        description: options.description ?? '',
        skills: {
          example: {
            description: 'Example skill',
            prompt: 'Describe what this skill does...',
          },
        },
        mcps: {},
        memory: {
          paths: ['./memory'],
        },
      };

      await mkdir(profilesDir, { recursive: true });
      await writeFile(profilePath, YAML.stringify(scaffold), 'utf8');

      return { profilePath };
    },

    async update(options) {
      const cwd = options.cwd ?? process.cwd();
      const profilePath = path.join(cwd, PROFILES_DIR, `${options.name}.yaml`);

      if (!(await pathExists(profilePath))) {
        throw new ProfileNotFoundError(`Profile "${options.name}" not found.`);
      }

      const normalized = normalizeProfileConfig(options.config, options.name);

      const data: Record<string, unknown> = {
        name: normalized.name,
        ...(normalized.description ? { description: normalized.description } : {}),
        skills: normalized.skills,
        mcps: normalized.mcps,
        memory: normalized.memory,
      };

      await writeFile(profilePath, YAML.stringify(data), 'utf8');
    },

    async delete(options) {
      const cwd = options.cwd ?? process.cwd();
      const profilePath = path.join(cwd, PROFILES_DIR, `${options.name}.yaml`);

      if (!(await pathExists(profilePath))) {
        throw new ProfileNotFoundError(`Profile "${options.name}" not found.`);
      }

      const meta = await loadMetaConfig(cwd);
      if (meta.active_profile === options.name) {
        throw new ProfileError('Cannot delete the active profile.');
      }

      await unlink(profilePath);
    },

    async use(options) {
      const cwd = options.cwd ?? process.cwd();

      // Validate profile exists
      const profilePath = path.join(cwd, PROFILES_DIR, `${options.name}.yaml`);
      if (!(await pathExists(profilePath))) {
        throw new ProfileNotFoundError(`Profile "${options.name}" not found.`);
      }

      const meta = await loadMetaConfig(cwd);
      const previousProfile = meta.active_profile || null;

      meta.active_profile = options.name;

      const metaPath = path.join(cwd, META_CONFIG);
      await mkdir(path.dirname(metaPath), { recursive: true });
      await writeFile(metaPath, YAML.stringify(meta), 'utf8');

      return { previousProfile };
    },

    async getMetaConfig(options = {}) {
      const cwd = options.cwd ?? process.cwd();
      return loadMetaConfig(cwd);
    },
  };
}

async function loadMetaConfig(cwd: string): Promise<BrainctlMetaConfig> {
  const metaPath = path.join(cwd, META_CONFIG);

  try {
    const source = await readFile(metaPath, 'utf8');
    const parsed = YAML.parse(source) ?? {};
    return {
      active_profile: typeof parsed.active_profile === 'string' ? parsed.active_profile : '',
      agents: Array.isArray(parsed.agents) ? parsed.agents : ['claude', 'codex'],
    };
  } catch {
    return { active_profile: '', agents: ['claude', 'codex', 'gemini'] };
  }
}

export function parseProfile(source: string, name: string): ProfileConfig {
  let parsed: unknown;
  try {
    parsed = YAML.parse(source) ?? {};
  } catch {
    throw new ProfileError(`Profile "${name}" has invalid YAML.`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ProfileError(`Profile "${name}" has invalid structure.`);
  }

  return normalizeProfileConfig(parsed as Record<string, unknown>, name);
}

export function normalizeProfileConfig(value: unknown, name: string): ProfileConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ProfileError(`Profile "${name}" has invalid structure.`);
  }

  const data = value as Record<string, unknown>;
  const skills: Record<string, SkillConfig> = {};
  if (data.skills && typeof data.skills === 'object' && !Array.isArray(data.skills)) {
    for (const [key, value] of Object.entries(data.skills as Record<string, unknown>)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const s = value as Record<string, unknown>;
        if (typeof s.prompt === 'string') {
          skills[key] = {
            prompt: s.prompt,
            description: typeof s.description === 'string' ? s.description : undefined,
          };
        }
      }
    }
  }

  const mcps = normalizeMcps(data.mcps, name);

  const memoryPaths: string[] = [];
  if (data.memory && typeof data.memory === 'object' && !Array.isArray(data.memory)) {
    const mem = data.memory as Record<string, unknown>;
    if (Array.isArray(mem.paths)) {
      for (const p of mem.paths) {
        if (typeof p === 'string') {
          memoryPaths.push(p);
        }
      }
    }
  }

  return {
    name: typeof data.name === 'string' ? data.name : name,
    description: typeof data.description === 'string' ? data.description : undefined,
    skills,
    mcps,
    memory: { paths: memoryPaths },
  };
}

function normalizeMcps(value: unknown, profileName: string): Record<string, McpServerConfig> {
  if (value === undefined || value === null) {
    return {};
  }

  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new ProfileError(`Profile "${profileName}" has an invalid "mcps" section.`);
  }

  const mcps: Record<string, McpServerConfig> = {};

  for (const [key, rawValue] of Object.entries(value as Record<string, unknown>)) {
    if (!rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) {
      throw new ProfileError(`MCP "${key}" must be an object.`);
    }

    const mcp = rawValue as Record<string, unknown>;

    // Local profile files may still use the older type-based shape.
    if (mcp.type === 'npm') {
      if (typeof mcp.package !== 'string' || mcp.package.trim().length === 0) {
        throw new ProfileError(`Local MCP "${key}" must include a non-empty package.`);
      }

      mcps[key] = {
        kind: 'local',
        source: 'npm',
        package: mcp.package,
        env: parseStringMap(mcp.env),
      };
      continue;
    }

    if (mcp.type === 'bundled') {
      if (
        typeof mcp.path !== 'string' ||
        mcp.path.trim().length === 0 ||
        typeof mcp.command !== 'string' ||
        mcp.command.trim().length === 0
      ) {
        throw new ProfileError(
          `Bundled local MCP "${key}" must include non-empty path and command fields.`
        );
      }

      mcps[key] = {
        kind: 'local',
        source: 'bundled',
        runtime: parseMcpRuntime(mcp.runtime),
        path: mcp.path,
        install: typeof mcp.install === 'string' ? mcp.install : undefined,
        command: mcp.command,
        args: parseStringArray(mcp.args),
        ...(Array.isArray(mcp.exclude) ? { exclude: mcp.exclude.filter((v: unknown) => typeof v === 'string') } : {}),
        env: parseStringMap(mcp.env),
      };
      continue;
    }

    if (mcp.kind !== 'local' && mcp.kind !== 'remote') {
      throw new ProfileError(`MCP "${key}" must declare kind "local" or "remote".`);
    }

    if (mcp.kind === 'remote') {
      if (
        (mcp.transport !== 'http' && mcp.transport !== 'sse') ||
        typeof mcp.url !== 'string' ||
        mcp.url.trim().length === 0
      ) {
        throw new ProfileError(
          `Remote MCP "${key}" must include transport ("http" or "sse") and a url.`
        );
      }

      mcps[key] = {
        kind: 'remote',
        transport: mcp.transport,
        url: mcp.url,
        headers: parseStringMap(mcp.headers),
        env: parseStringMap(mcp.env),
      };
      continue;
    }

    if (mcp.source !== 'npm' && mcp.source !== 'bundled') {
      throw new ProfileError(`Local MCP "${key}" must declare source "npm" or "bundled".`);
    }

    if (mcp.source === 'npm') {
      if (typeof mcp.package !== 'string' || mcp.package.trim().length === 0) {
        throw new ProfileError(`Local MCP "${key}" must include a non-empty package.`);
      }

      mcps[key] = {
        kind: 'local',
        source: 'npm',
        package: mcp.package,
        env: parseStringMap(mcp.env),
      };
      continue;
    }

    if (
      typeof mcp.path !== 'string' ||
      mcp.path.trim().length === 0 ||
      typeof mcp.command !== 'string' ||
      mcp.command.trim().length === 0
    ) {
      throw new ProfileError(
        `Bundled local MCP "${key}" must include non-empty path and command fields.`
      );
    }

    mcps[key] = {
      kind: 'local',
      source: 'bundled',
      runtime: parseMcpRuntime(mcp.runtime),
      path: mcp.path,
      install: typeof mcp.install === 'string' ? mcp.install : undefined,
      command: mcp.command,
      args: parseStringArray(mcp.args),
      ...(Array.isArray(mcp.exclude) ? { exclude: mcp.exclude.filter((v: unknown) => typeof v === 'string') } : {}),
      env: parseStringMap(mcp.env),
    };
  }

  return mcps;
}

function parseStringMap(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    result[k] = String(v);
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function parseMcpRuntime(value: unknown): McpRuntime {
  if (typeof value === 'string' && VALID_RUNTIMES.has(value as McpRuntime)) {
    return value as McpRuntime;
  }
  return 'node';
}

function parseStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const items = value.map(String);
  return items.length > 0 ? items : undefined;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}
