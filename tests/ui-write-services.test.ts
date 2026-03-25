import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../src/config.js';
import { ConfigError, MemoryPathError } from '../src/errors.js';
import { createConfigWriteService } from '../src/services/config-write-service.js';
import { createMemoryWriteService } from '../src/services/memory-write-service.js';
import type { BrainctlConfig } from '../src/types.js';

const tempDirs: string[] = [];

describe('ui write services', () => {
  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map(async (dir) => {
        await rm(dir, { recursive: true, force: true });
      })
    );
  });

  it('persists structured skills and MCP updates to ai-stack.yaml', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'brainctl-ui-write-'));
    tempDirs.push(cwd);

    await writeFile(
      path.join(cwd, 'ai-stack.yaml'),
      [
        'memory:',
        '  paths:',
        '    - ./memory',
        'skills:',
        '  summarize:',
        '    description: Summarize content',
        '    prompt: |',
        '      Summarize the following content into concise bullet points.',
        'mcps: {}'
      ].join('\n'),
      'utf8'
    );

    const config = await loadConfig({ cwd });
    const updatedConfig: BrainctlConfig = {
      ...config,
      skills: {
        ...config.skills,
        analyze: {
          description: 'Analyze content deeply',
          prompt: 'Analyze the following content and extract key insights.'
        }
      },
      mcps: {
        localSearch: {
          command: 'mcp-local-search',
          enabled: true
        }
      }
    };

    const service = createConfigWriteService();
    await service.execute({ cwd, config: updatedConfig });

    const persisted = await loadConfig({ cwd });
    expect(persisted.skills).toHaveProperty('summarize');
    expect(persisted.skills).toHaveProperty('analyze');
    expect(persisted.skills.analyze.description).toBe('Analyze content deeply');
    expect(persisted.mcps).toEqual({
      localSearch: {
        command: 'mcp-local-search',
        enabled: true
      }
    });
  });

  it('saves markdown edits to the selected memory file', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'brainctl-ui-memory-'));
    tempDirs.push(cwd);

    const memoryDir = path.join(cwd, 'memory');
    const filePath = path.join(memoryDir, 'notes.md');
    await mkdir(memoryDir, { recursive: true });
    await writeFile(filePath, '# Notes\nInitial content.\n', 'utf8');

    const service = createMemoryWriteService();
    await service.execute({
      cwd,
      filePath,
      content: '# Notes\nUpdated content.\n'
    });

    const saved = await readFile(filePath, 'utf8');
    expect(saved).toBe('# Notes\nUpdated content.\n');
  });

  it('rejects memory writes outside the workspace root', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'brainctl-ui-memory-'));
    tempDirs.push(cwd);

    const outsideDir = await mkdtemp(path.join(os.tmpdir(), 'brainctl-ui-outside-'));
    tempDirs.push(outsideDir);

    const service = createMemoryWriteService();

    await expect(
      service.execute({
        cwd,
        filePath: path.join(outsideDir, 'notes.md'),
        content: 'outside'
      })
    ).rejects.toBeInstanceOf(MemoryPathError);
  });

  it('rejects config writes that escape the workspace root', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'brainctl-ui-config-'));
    tempDirs.push(cwd);

    const outsideDir = await mkdtemp(path.join(os.tmpdir(), 'brainctl-ui-outside-'));
    tempDirs.push(outsideDir);

    await writeFile(
      path.join(cwd, 'ai-stack.yaml'),
      [
        'memory:',
        '  paths:',
        '    - ./memory',
        'skills:',
        '  summarize:',
        '    description: Summarize content',
        '    prompt: |',
        '      Summarize the following content into concise bullet points.',
        'mcps: {}'
      ].join('\n'),
      'utf8'
    );

    const config = await loadConfig({ cwd });
    const service = createConfigWriteService();

    await expect(
      service.execute({
        cwd,
        config: {
          ...config,
          memory: {
            paths: [path.join(outsideDir, 'memory')]
          }
        }
      })
    ).rejects.toBeInstanceOf(ConfigError);
  });
});
