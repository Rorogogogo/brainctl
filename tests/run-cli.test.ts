import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createProgram } from '../src/cli.js';
import type { Executor } from '../src/executor/types.js';
import { createRunService } from '../src/services/run-service.js';
import type { AgentAvailability, ExecutorResolver } from '../src/executor/resolver.js';

const tempDirs: string[] = [];

describe('brainctl run', () => {
  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map(async (dir) => {
        await import('node:fs/promises').then(({ rm }) =>
          rm(dir, { recursive: true, force: true })
        );
      })
    );
  });

  it('builds context from config, memory, skill, and input before invoking the executor', async () => {
    const projectDir = await mkdtemp(path.join(os.tmpdir(), 'brainctl-run-'));
    const memoryDir = path.join(projectDir, 'memory');
    const inputFile = path.join(projectDir, 'input.md');
    tempDirs.push(projectDir);

    await mkdir(memoryDir, { recursive: true });
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
    await writeFile(path.join(memoryDir, 'notes.md'), '# Memory\nRemember priorities.', 'utf8');
    await writeFile(inputFile, 'Draft the status update.', 'utf8');

    let receivedContext = '';

    const executor: Executor = {
      agent: 'claude',
      async run(context) {
        receivedContext = context;
        return {
          output: 'mocked output',
          exitCode: 0,
          agent: 'claude'
        };
      }
    };

    const availability: Record<string, AgentAvailability> = {
      claude: { agent: 'claude', available: true, command: 'claude' },
      codex: { agent: 'codex', available: false, command: 'codex' }
    };

    const resolver: ExecutorResolver = {
      async resolveExecutor() {
        return executor;
      },
      async getAgentAvailability() {
        return availability;
      }
    };

    const runService = createRunService({ resolver });
    const program = createProgram({
      runService
    });

    const previousCwd = process.cwd();
    process.chdir(projectDir);

    try {
      await program.parseAsync(
        ['node', 'brainctl', 'run', 'summarize', './input.md', '--with', 'claude'],
        { from: 'node' }
      );
    } finally {
      process.chdir(previousCwd);
    }

    expect(receivedContext).toBe(
      '--- MEMORY ---\n' +
        '# Memory\nRemember priorities.\n\n' +
        '--- SKILL ---\n' +
        'Summarize the following content into concise bullet points.\n\n' +
        '--- INPUT ---\n' +
        'Draft the status update.'
    );
  });
});
