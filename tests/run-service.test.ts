import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { AgentNotAvailableError } from '../src/errors.js';
import type { ExecutorResolver } from '../src/executor/resolver.js';
import type { Executor } from '../src/executor/types.js';
import { createRunService } from '../src/services/run-service.js';

const tempDirs: string[] = [];

describe('createRunService', () => {
  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map(async (dir) => {
        await import('node:fs/promises').then(({ rm }) =>
          rm(dir, { recursive: true, force: true })
        );
      })
    );
  });

  it('uses the fallback agent only when the primary agent is unavailable', async () => {
    const projectDir = await createProject();
    let fallbackRuns = 0;

    const fallbackExecutor: Executor = {
      agent: 'codex',
      async run() {
        fallbackRuns += 1;
        return {
          output: 'fallback output',
          exitCode: 0,
          agent: 'codex'
        };
      }
    };

    const resolver: ExecutorResolver = {
      async resolveExecutor(agentName) {
        if (agentName === 'claude') {
          throw new AgentNotAvailableError('Agent "claude" is not available on PATH.');
        }

        return fallbackExecutor;
      },
      async getAgentAvailability() {
        return {
          claude: { agent: 'claude', available: false, command: 'claude' },
          codex: { agent: 'codex', available: true, command: 'codex' }
        };
      }
    };

    const service = createRunService({ resolver });
    const trace = await service.execute({
      cwd: projectDir,
      skill: 'summarize',
      inputFile: './input.md',
      primaryAgent: 'claude',
      fallbackAgent: 'codex'
    });

    expect(fallbackRuns).toBe(1);
    expect(trace.steps[0]).toMatchObject({
      agent: 'codex',
      fallbackUsed: true,
      exitCode: 0
    });
  });

  it('does not use the fallback agent for non-availability resolver failures', async () => {
    const projectDir = await createProject();
    let fallbackRuns = 0;

    const resolver: ExecutorResolver = {
      async resolveExecutor(agentName) {
        if (agentName === 'claude') {
          throw new Error('Resolver crashed');
        }

        return {
          agent: 'codex',
          async run() {
            fallbackRuns += 1;
            return {
              output: 'fallback output',
              exitCode: 0,
              agent: 'codex'
            };
          }
        };
      },
      async getAgentAvailability() {
        return {
          claude: { agent: 'claude', available: true, command: 'claude' },
          codex: { agent: 'codex', available: true, command: 'codex' }
        };
      }
    };

    const service = createRunService({ resolver });

    await expect(
      service.execute({
        cwd: projectDir,
        skill: 'summarize',
        inputFile: './input.md',
        primaryAgent: 'claude',
        fallbackAgent: 'codex'
      })
    ).rejects.toThrowError('Resolver crashed');

    expect(fallbackRuns).toBe(0);
  });
});

async function createProject(): Promise<string> {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), 'brainctl-run-service-'));
  const memoryDir = path.join(projectDir, 'memory');
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
  await writeFile(path.join(projectDir, 'input.md'), 'Draft the update.', 'utf8');

  return projectDir;
}
