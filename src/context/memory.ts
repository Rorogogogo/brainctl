import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { MemoryPathError } from '../errors.js';
import type { MemoryLoadResult } from '../types.js';

export interface LoadMemoryOptions {
  paths: string[];
}

export async function loadMemory(options: LoadMemoryOptions): Promise<MemoryLoadResult> {
  const markdownFiles = (
    await Promise.all(options.paths.map(async (memoryPath) => collectMarkdownFiles(memoryPath)))
  )
    .flat()
    .sort((left, right) => left.localeCompare(right));

  const entries = await Promise.all(
    markdownFiles.map(async (filePath) => ({
      path: filePath,
      content: await readFile(filePath, 'utf8')
    }))
  );
  const contents = entries.map((entry) => entry.content.trim());

  return {
    files: markdownFiles,
    count: markdownFiles.length,
    content: contents.filter((entry) => entry.length > 0).join('\n\n'),
    entries
  };
}

async function collectMarkdownFiles(targetPath: string): Promise<string[]> {
  let targetStats;

  try {
    targetStats = await stat(targetPath);
  } catch (error) {
    throw new MemoryPathError(`Memory path does not exist: ${targetPath}`);
  }

  if (!targetStats.isDirectory()) {
    throw new MemoryPathError(`Memory path is not a directory: ${targetPath}`);
  }

  const entries = await readdir(targetPath, { withFileTypes: true });
  const nestedResults = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(targetPath, entry.name);

      if (entry.isDirectory()) {
        return collectMarkdownFiles(entryPath);
      }

      if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.md') {
        return [entryPath];
      }

      return [];
    })
  );

  return nestedResults.flat();
}
