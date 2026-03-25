import { mkdir, writeFile } from 'node:fs/promises';
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

      if (!isWithinDirectory(cwd, targetPath)) {
        throw new MemoryPathError('Memory files must stay within the workspace root.');
      }

      await mkdir(path.dirname(targetPath), { recursive: true });
      await writeFile(targetPath, request.content, 'utf8');

      return { filePath: targetPath };
    }
  };
}

function isWithinDirectory(parentDirectory: string, targetPath: string): boolean {
  const relativePath = path.relative(parentDirectory, targetPath);

  if (relativePath === '') {
    return true;
  }

  return !relativePath.startsWith(`..${path.sep}`) && relativePath !== '..' && !path.isAbsolute(relativePath);
}
