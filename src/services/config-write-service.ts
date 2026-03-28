import { lstat, mkdir, realpath, writeFile } from 'node:fs/promises';
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
      const memoryPaths = await Promise.all(
        request.config.memory.paths.map((memoryPath) => normalizeMemoryPath(cwd, memoryPath))
      );

      const payload = {
        memory: {
          paths: memoryPaths
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

async function normalizeMemoryPath(cwd: string, filePath: string): Promise<string> {
  const workspaceRoot = await realpath(cwd);
  const resolvedPath = path.resolve(cwd, filePath);
  const realTargetPath = await resolvePathForWrite(resolvedPath);

  if (!isWithinDirectory(workspaceRoot, realTargetPath)) {
    throw new ConfigError('Memory paths must stay within the workspace root.');
  }

  const relativePath = path.relative(cwd, resolvedPath);
  return relativePath.length > 0 ? relativePath : '.';
}

async function resolvePathForWrite(targetPath: string): Promise<string> {
  const existingPath = await findNearestExistingPath(targetPath);
  const resolvedExistingPath = await realpath(existingPath);

  if (existingPath === targetPath) {
    return resolvedExistingPath;
  }

  return path.resolve(resolvedExistingPath, path.relative(existingPath, targetPath));
}

async function findNearestExistingPath(targetPath: string): Promise<string> {
  let currentPath = targetPath;

  while (true) {
    try {
      await lstat(currentPath);
      return currentPath;
    } catch (error) {
      if (!isMissingPathError(error)) {
        throw error;
      }
    }

    const parentPath = path.dirname(currentPath);

    if (parentPath === currentPath) {
      throw new ConfigError(`Could not resolve filesystem path for ${targetPath}.`);
    }

    currentPath = parentPath;
  }
}

function isWithinDirectory(parentDirectory: string, targetPath: string): boolean {
  const relativePath = path.relative(parentDirectory, targetPath);

  if (relativePath === '') {
    return true;
  }

  return !relativePath.startsWith(`..${path.sep}`) && relativePath !== '..' && !path.isAbsolute(relativePath);
}

function isMissingPathError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
