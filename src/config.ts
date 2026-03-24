import { readFile } from 'node:fs/promises';
import path from 'node:path';

import YAML from 'yaml';

import { ConfigError } from './errors.js';
import type { BrainctlConfig, SkillConfig } from './types.js';

interface LoadConfigOptions {
  cwd?: string;
}

interface ParsedConfig {
  memory?: {
    paths?: unknown;
  };
  skills?: unknown;
  mcps?: unknown;
}

export async function loadConfig(options: LoadConfigOptions = {}): Promise<BrainctlConfig> {
  const cwd = options.cwd ?? process.cwd();
  const configPath = path.join(cwd, 'ai-stack.yaml');

  let source: string;

  try {
    source = await readFile(configPath, 'utf8');
  } catch (error) {
    throw new ConfigError(`Could not read ai-stack.yaml in ${cwd}.`);
  }

  let parsed: ParsedConfig;

  try {
    parsed = (YAML.parse(source) ?? {}) as ParsedConfig;
  } catch (error) {
    throw new ConfigError('ai-stack.yaml could not be parsed.');
  }

  if (!parsed.memory || !Array.isArray(parsed.memory.paths)) {
    throw new ConfigError('ai-stack.yaml is missing the required "memory.paths" section.');
  }

  if (!parsed.skills || typeof parsed.skills !== 'object' || Array.isArray(parsed.skills)) {
    throw new ConfigError('ai-stack.yaml is missing the required "skills" section.');
  }

  const skills = normalizeSkills(parsed.skills);

  return {
    configPath,
    rootDir: cwd,
    memory: {
      paths: parsed.memory.paths.map((memoryPath) => {
        if (typeof memoryPath !== 'string' || memoryPath.trim().length === 0) {
          throw new ConfigError('ai-stack.yaml contains an invalid memory path.');
        }

        return path.resolve(cwd, memoryPath);
      })
    },
    skills,
    mcps: normalizeMcps(parsed.mcps)
  };
}

function normalizeSkills(value: unknown): Record<string, SkillConfig> {
  const entries = Object.entries(value as Record<string, unknown>);

  if (entries.length === 0) {
    throw new ConfigError('ai-stack.yaml must define at least one skill.');
  }

  return Object.fromEntries(
    entries.map(([name, skillValue]) => {
      if (!skillValue || typeof skillValue !== 'object' || Array.isArray(skillValue)) {
        throw new ConfigError(`Skill "${name}" must be an object with a prompt.`);
      }

      const prompt = (skillValue as { prompt?: unknown }).prompt;
      const description = (skillValue as { description?: unknown }).description;

      if (typeof prompt !== 'string' || prompt.trim().length === 0) {
        throw new ConfigError(`Skill "${name}" is missing a valid prompt.`);
      }

      if (description !== undefined && typeof description !== 'string') {
        throw new ConfigError(`Skill "${name}" has an invalid description.`);
      }

      return [
        name,
        {
          prompt,
          description
        } satisfies SkillConfig
      ];
    })
  );
}

function normalizeMcps(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) {
    return {};
  }

  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new ConfigError('The "mcps" section must be an object when present.');
  }

  return value as Record<string, unknown>;
}
