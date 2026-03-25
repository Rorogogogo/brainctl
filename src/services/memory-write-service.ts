import { lstat, mkdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { MemoryPathError } from '../errors.js';

export interface MemoryWriteRequest {
  cwd?: string;
  filePath: string;
  content: string;
}

export interface MemoryWriteResult {
  filePath: string;
}

export interface MemoryWriteService {
  execute(request: MemoryWriteRequest): Promise<MemoryWriteResult>;
}

export function createMemoryWriteService(): MemoryWriteService {
  return {
    async execute(request: MemoryWriteRequest): Promise<MemoryWriteResult> {
      const cwd = request.cwd ?? process.cwd();
      const targetPath = path.resolve(cwd, request.filePath);
      const workspaceRoot = await realpath(cwd);
      const resolvedTargetPath = await resolvePathForWrite(targetPath);

      if (!isWithinDirectory(workspaceRoot, resolvedTargetPath)) {
        throw new MemoryPathError('Memory files must stay within the workspace root.');
      }

      await mkdir(path.dirname(targetPath), { recursive: true });
      await writeFile(targetPath, request.content, 'utf8');

      return { filePath: targetPath };
    }
  };
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
      throw new MemoryPathError(`Could not resolve filesystem path for ${targetPath}.`);
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
