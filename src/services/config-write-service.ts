import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import YAML from 'yaml';

import { ConfigError } from '../errors.js';
import type { BrainctlConfig } from '../types.js';

export interface ConfigWriteRequest {
  cwd?: string;
  config: BrainctlConfig;
}

export interface ConfigWriteResult {
  configPath: string;
}

export interface ConfigWriteService {
  execute(request: ConfigWriteRequest): Promise<ConfigWriteResult>;
}

export function createConfigWriteService(): ConfigWriteService {
  return {
    async execute(request: ConfigWriteRequest): Promise<ConfigWriteResult> {
      const cwd = request.cwd ?? process.cwd();
      const configPath = path.join(cwd, 'ai-stack.yaml');

      const payload = {
        memory: {
          paths: request.config.memory.paths.map((memoryPath) =>
            normalizeMemoryPath(cwd, memoryPath)
          )
        },
        skills: request.config.skills,
        mcps: request.config.mcps
      };

      await mkdir(path.dirname(configPath), { recursive: true });
      await writeFile(configPath, `${YAML.stringify(payload)}`, 'utf8');

      return { configPath };
    }
  };
}

function normalizeMemoryPath(cwd: string, filePath: string): string {
  const resolvedPath = path.resolve(cwd, filePath);

  if (!isWithinDirectory(cwd, resolvedPath)) {
    throw new ConfigError('Memory paths must stay within the workspace root.');
  }

  const relativePath = path.relative(cwd, resolvedPath);
  return relativePath.length > 0 ? relativePath : '.';
}

function isWithinDirectory(parentDirectory: string, targetPath: string): boolean {
  const relativePath = path.relative(parentDirectory, targetPath);

  if (relativePath === '') {
    return true;
  }

  return !relativePath.startsWith(`..${path.sep}`) && relativePath !== '..' && !path.isAbsolute(relativePath);
}
