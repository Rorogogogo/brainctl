import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadMemory } from '../src/context/memory.js';

const tempDirs: string[] = [];

describe('loadMemory', () => {
  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map(async (dir) => {
        await import('node:fs/promises').then(({ rm }) =>
          rm(dir, { recursive: true, force: true })
        );
      })
    );
  });

  it('loads markdown files from multiple memory paths in deterministic order', async () => {
    const projectDir = await mkdtemp(path.join(os.tmpdir(), 'brainctl-memory-'));
    const memoryA = path.join(projectDir, 'memory-a');
    const memoryB = path.join(projectDir, 'memory-b');
    tempDirs.push(projectDir);

    await mkdir(memoryA, { recursive: true });
    await mkdir(path.join(memoryB, 'nested'), { recursive: true });
    await writeFile(path.join(memoryA, 'b.md'), 'Second file', 'utf8');
    await writeFile(path.join(memoryA, 'ignore.txt'), 'Ignore me', 'utf8');
    await writeFile(path.join(memoryB, 'nested', 'a.md'), 'First file', 'utf8');

    const result = await loadMemory({
      paths: [memoryA, memoryB]
    });

    expect(result.files).toEqual([
      path.join(memoryA, 'b.md'),
      path.join(memoryB, 'nested', 'a.md')
    ]);
    expect(result.count).toBe(2);
    expect(result.content).toBe('Second file\n\nFirst file');
  });

  it('includes the content for each markdown file so the UI can preview one file at a time', async () => {
    const projectDir = await mkdtemp(path.join(os.tmpdir(), 'brainctl-memory-'));
    const memoryDir = path.join(projectDir, 'memory');
    tempDirs.push(projectDir);

    await mkdir(memoryDir, { recursive: true });
    await writeFile(path.join(memoryDir, 'notes.md'), '# Notes\nKeep context close.', 'utf8');

    const result = await loadMemory({
      paths: [memoryDir]
    });

    expect(result.entries).toEqual([
      {
        path: path.join(memoryDir, 'notes.md'),
        content: '# Notes\nKeep context close.'
      }
    ]);
  });

  it('returns an empty result for empty directories', async () => {
    const projectDir = await mkdtemp(path.join(os.tmpdir(), 'brainctl-memory-'));
    const memoryDir = path.join(projectDir, 'memory');
    tempDirs.push(projectDir);

    await mkdir(memoryDir, { recursive: true });

    const result = await loadMemory({
      paths: [memoryDir]
    });

    expect(result.files).toEqual([]);
    expect(result.count).toBe(0);
    expect(result.content).toBe('');
  });
});
