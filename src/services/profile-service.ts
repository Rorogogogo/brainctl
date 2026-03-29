import { readdir, readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';

import YAML from 'yaml';

import { ProfileError, ProfileNotFoundError } from '../errors.js';
import type { AgentName, BrainctlMetaConfig, McpServerConfig, ProfileConfig, SkillConfig } from '../types.js';

const BRAINCTL_DIR = '.brainctl';
const PROFILES_DIR = '.brainctl/profiles';
const META_CONFIG = '.brainctl/config.yaml';

export interface ProfileService {
  list(options?: { cwd?: string }): Promise<{ profiles: string[]; activeProfile: string | null }>;
  get(options: { cwd?: string; name: string }): Promise<ProfileConfig>;
  create(options: { cwd?: string; name: string; description?: string }): Promise<{ profilePath: string }>;
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

  const data = parsed as Record<string, unknown>;

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

  const mcps: Record<string, McpServerConfig> = {};
  if (data.mcps && typeof data.mcps === 'object' && !Array.isArray(data.mcps)) {
    for (const [key, value] of Object.entries(data.mcps as Record<string, unknown>)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const m = value as Record<string, unknown>;
        if (m.type === 'npm' && typeof m.package === 'string') {
          mcps[key] = {
            type: 'npm',
            package: m.package,
            env: parseEnv(m.env),
          };
        } else if (m.type === 'bundled' && typeof m.command === 'string') {
          mcps[key] = {
            type: 'bundled',
            path: typeof m.path === 'string' ? m.path : '.',
            install: typeof m.install === 'string' ? m.install : undefined,
            command: m.command,
            args: Array.isArray(m.args) ? m.args.map(String) : undefined,
            env: parseEnv(m.env),
          };
        }
      }
    }
  }

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

function parseEnv(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    result[k] = String(v);
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}
