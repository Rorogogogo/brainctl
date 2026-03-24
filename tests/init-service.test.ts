import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createInitService } from '../src/services/init-service.js';

const tempDirs: string[] = [];

describe('createInitService', () => {
  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map(async (dir) => {
        await import('node:fs/promises').then(({ rm }) =>
          rm(dir, { recursive: true, force: true })
        );
      })
    );
  });

  it('treats an already initialized directory as a no-op without --force', async () => {
    const projectDir = await mkdtemp(path.join(os.tmpdir(), 'brainctl-init-'));
    tempDirs.push(projectDir);

    await mkdir(path.join(projectDir, 'memory'), { recursive: true });
    await writeFile(path.join(projectDir, 'ai-stack.yaml'), 'mcps: {}\nskills: {}\nmemory:\n  paths:\n    - ./memory\n', 'utf8');
    await writeFile(path.join(projectDir, 'memory', 'notes.md'), '# Notes\n', 'utf8');

    const result = await createInitService().execute({
      cwd: projectDir
    });

    expect(result.alreadyInitialized).toBe(true);
    expect(result.created).toEqual([]);
    expect(result.replaced).toEqual([]);
  });
});
