import { readdir, readFile, writeFile, mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';

import YAML from 'yaml';

import { ProfileError, ProfileNotFoundError } from '../../errors.js';
import type { McpRuntime, McpServerConfig, ProfileConfig } from '../../types.js';

const VALID_RUNTIMES = new Set<McpRuntime>(['node', 'python', 'java', 'go', 'rust', 'binary']);

const PROFILES_DIR = '.brainctl/profiles';
const PROFILE_FILE = 'profile.yaml';

export function profileDir(cwd: string, name: string): string {
  return path.join(cwd, PROFILES_DIR, name);
}

export function profileFile(cwd: string, name: string): string {
  return path.join(profileDir(cwd, name), PROFILE_FILE);
}

function legacyProfileFile(cwd: string, name: string): string {
  return path.join(cwd, PROFILES_DIR, `${name}.yaml`);
}

async function migrateLegacyProfile(cwd: string, name: string): Promise<void> {
  const legacy = legacyProfileFile(cwd, name);
  const folder = profileDir(cwd, name);
  const newFile = profileFile(cwd, name);

  if (!(await pathExists(legacy))) return;
  if (await pathExists(newFile)) return;

  await mkdir(folder, { recursive: true });
  await rename(legacy, newFile);
}

export interface ProfileService {
  list(options?: { cwd?: string }): Promise<{ profiles: string[] }>;
  get(options: { cwd?: string; name: string }): Promise<ProfileConfig>;
  create(options: { cwd?: string; name: string; description?: string }): Promise<{ profilePath: string }>;
  update(options: { cwd?: string; name: string; config: ProfileConfig }): Promise<void>;
  rename(options: { cwd?: string; oldName: string; newName: string }): Promise<void>;
  delete(options: { cwd?: string; name: string }): Promise<void>;
}

const PROFILE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function createProfileService(): ProfileService {
  return {
    async list(options = {}) {
      const cwd = options.cwd ?? process.cwd();
      const profilesDir = path.join(cwd, PROFILES_DIR);

      const names = new Set<string>();
      try {
        const entries = await readdir(profilesDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            if (await pathExists(path.join(profilesDir, entry.name, PROFILE_FILE))) {
              names.add(entry.name);
            }
          } else if (entry.isFile() && entry.name.endsWith('.yaml')) {
            const bare = entry.name.replace(/\.yaml$/, '');
            await migrateLegacyProfile(cwd, bare);
            names.add(bare);
          }
        }
      } catch {
        // No profiles directory yet
      }

      return {
        profiles: Array.from(names).sort(),
      };
    },

    async get(options) {
      const cwd = options.cwd ?? process.cwd();
      await migrateLegacyProfile(cwd, options.name);
      const filePath = profileFile(cwd, options.name);

      let source: string;
      try {
        source = await readFile(filePath, 'utf8');
      } catch {
        throw new ProfileNotFoundError(`Profile "${options.name}" not found at ${filePath}`);
      }

      return parseProfile(source, options.name);
    },

    async create(options) {
      const cwd = options.cwd ?? process.cwd();
      const trimmed = options.name.trim();

      if (!PROFILE_NAME_PATTERN.test(trimmed)) {
        throw new ProfileError(
          `Invalid profile name "${trimmed}". Use letters, numbers, ".", "_", or "-".`
        );
      }

      const folder = profileDir(cwd, trimmed);
      const filePath = profileFile(cwd, trimmed);

      if (
        (await pathExists(filePath)) ||
        (await pathExists(legacyProfileFile(cwd, trimmed)))
      ) {
        throw new ProfileError(`Profile "${trimmed}" already exists.`);
      }

      const scaffold: Record<string, unknown> = {
        name: trimmed,
        description: options.description ?? '',
        mcps: {},
      };

      await mkdir(folder, { recursive: true });
      await writeFile(filePath, YAML.stringify(scaffold), 'utf8');

      return { profilePath: filePath };
    },

    async update(options) {
      const cwd = options.cwd ?? process.cwd();
      await migrateLegacyProfile(cwd, options.name);
      const filePath = profileFile(cwd, options.name);

      if (!(await pathExists(filePath))) {
        throw new ProfileNotFoundError(`Profile "${options.name}" not found.`);
      }

      const normalized = normalizeProfileConfig(options.config, options.name);

      const data: Record<string, unknown> = {
        name: normalized.name,
        ...(normalized.description ? { description: normalized.description } : {}),
        mcps: normalized.mcps,
      };

      await writeFile(filePath, YAML.stringify(data), 'utf8');
    },

    async rename(options) {
      const cwd = options.cwd ?? process.cwd();
      const trimmedNew = options.newName.trim();

      if (!PROFILE_NAME_PATTERN.test(trimmedNew)) {
        throw new ProfileError(
          `Invalid profile name "${trimmedNew}". Use letters, numbers, ".", "_", or "-".`
        );
      }

      if (trimmedNew === options.oldName) return;

      await migrateLegacyProfile(cwd, options.oldName);
      const oldFolder = profileDir(cwd, options.oldName);
      const oldFile = profileFile(cwd, options.oldName);
      const newFolder = profileDir(cwd, trimmedNew);
      const newFile = profileFile(cwd, trimmedNew);

      if (!(await pathExists(oldFile))) {
        throw new ProfileNotFoundError(`Profile "${options.oldName}" not found.`);
      }

      if (
        (await pathExists(newFolder)) ||
        (await pathExists(legacyProfileFile(cwd, trimmedNew)))
      ) {
        throw new ProfileError(`Profile "${trimmedNew}" already exists.`);
      }

      await rename(oldFolder, newFolder);

      const profileSource = await readFile(newFile, 'utf8');
      const parsed = (YAML.parse(profileSource) as Record<string, unknown>) ?? {};
      parsed.name = trimmedNew;
      await writeFile(newFile, YAML.stringify(parsed), 'utf8');

      const manifestPath = path.join(newFolder, 'manifest.yaml');
      if (await pathExists(manifestPath)) {
        try {
          const manifestSource = await readFile(manifestPath, 'utf8');
          const manifest = (YAML.parse(manifestSource) as Record<string, unknown>) ?? {};
          manifest.profileName = trimmedNew;
          await writeFile(manifestPath, YAML.stringify(manifest), 'utf8');
        } catch {
          // Manifest is best-effort; pack-time will rewrite it on next export.
        }
      }
    },

    async delete(options) {
      const cwd = options.cwd ?? process.cwd();
      await migrateLegacyProfile(cwd, options.name);
      const folder = profileDir(cwd, options.name);
      const filePath = profileFile(cwd, options.name);

      if (!(await pathExists(filePath))) {
        throw new ProfileNotFoundError(`Profile "${options.name}" not found.`);
      }

      await rm(folder, { recursive: true, force: true });
    },
  };
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
  const mcps = normalizeMcps(data.mcps, name);

  return {
    name: typeof data.name === 'string' ? data.name : name,
    description: typeof data.description === 'string' ? data.description : undefined,
    mcps,
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
