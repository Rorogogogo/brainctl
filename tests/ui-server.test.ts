import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { startUiServer } from '../src/ui/server.js';

const tempDirs: string[] = [];

describe('ui server', () => {
  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map(async (dir) => {
        await import('node:fs/promises').then(({ rm }) =>
          rm(dir, { recursive: true, force: true })
        );
      })
    );
  });

  it('returns overview, memory, config, and agent availability for the current project', async () => {
    const projectDir = await mkdtemp(path.join(os.tmpdir(), 'brainctl-ui-'));
    tempDirs.push(projectDir);

    await mkdir(path.join(projectDir, 'memory'), { recursive: true });
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
    await writeFile(
      path.join(projectDir, 'memory', 'notes.md'),
      '# Notes\nKeep context close to the project.',
      'utf8'
    );

    const server = await startUiServer({ cwd: projectDir, port: 0 });

    try {
      const overviewResponse = await fetch(new URL('/api/overview', server.url));
      expect(overviewResponse.ok).toBe(true);
      const overview = await overviewResponse.json();
      expect(overview.configPath).toBe(path.join(projectDir, 'ai-stack.yaml'));
      expect(overview.memory.count).toBe(1);
      expect(overview.skills).toEqual(['summarize']);

      const memoryResponse = await fetch(new URL('/api/memory', server.url));
      expect(memoryResponse.ok).toBe(true);
      const memory = await memoryResponse.json();
      expect(memory.files).toEqual([path.join(projectDir, 'memory', 'notes.md')]);
      expect(memory.count).toBe(1);

      const configResponse = await fetch(new URL('/api/config', server.url));
      expect(configResponse.ok).toBe(true);
      const config = await configResponse.json();
      expect(config.memory.paths).toEqual([path.join(projectDir, 'memory')]);
      expect(config.skills.summarize.description).toBe('Summarize content');

      const agentsResponse = await fetch(new URL('/api/agents', server.url));
      expect(agentsResponse.ok).toBe(true);
      const agents = await agentsResponse.json();
      expect(agents).toHaveProperty('claude');
      expect(agents).toHaveProperty('codex');
    } finally {
      await server.close();
    }
  });
});
