import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ConfigError } from '../src/errors.js';
import { loadConfig } from '../src/config.js';

const tempDirs: string[] = [];

describe('loadConfig', () => {
  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map(async (dir) => {
        await import('node:fs/promises').then(({ rm }) =>
          rm(dir, { recursive: true, force: true })
        );
      })
    );
  });

  it('parses a valid ai-stack.yaml file', async () => {
    const projectDir = await mkdtemp(path.join(os.tmpdir(), 'brainctl-config-'));
    tempDirs.push(projectDir);

    await writeFile(
      path.join(projectDir, 'ai-stack.yaml'),
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

    const config = await loadConfig({ cwd: projectDir });

    expect(config.memory.paths).toEqual([path.join(projectDir, 'memory')]);
    expect(config.skills.summarize.prompt).toBe(
      'Summarize the following content into concise bullet points.\n'
    );
    expect(config.mcps).toEqual({});
  });

  it('throws a ConfigError when required fields are missing', async () => {
    const projectDir = await mkdtemp(path.join(os.tmpdir(), 'brainctl-config-'));
    tempDirs.push(projectDir);

    await writeFile(
      path.join(projectDir, 'ai-stack.yaml'),
      [
        'memory:',
        '  paths:',
        '    - ./memory',
        'mcps: {}'
      ].join('\n'),
      'utf8'
    );

    await expect(loadConfig({ cwd: projectDir })).rejects.toMatchObject({
      constructor: ConfigError,
      message: 'ai-stack.yaml is missing the required "skills" section.'
    });
  });
});
