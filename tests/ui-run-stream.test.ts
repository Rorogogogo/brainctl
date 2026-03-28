import { createServer } from 'node:http';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createRunService } from '../src/services/run-service.js';
import { createUiRouteHandler } from '../src/ui/routes.js';
import type { ExecutorResolver } from '../src/executor/resolver.js';
import type { Executor } from '../src/executor/types.js';

const tempDirs: string[] = [];

describe('ui run stream endpoint', () => {
  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map(async (dir) => {
        await import('node:fs/promises').then(({ rm }) =>
          rm(dir, { recursive: true, force: true })
        );
      })
    );
  });

  it('streams output chunks and the final run result as SSE events', async () => {
    const projectDir = await createProject();
    const observedStreamOutput: Array<boolean | undefined> = [];
    const executor: Executor = {
      agent: 'claude',
      async run(_context, options) {
        observedStreamOutput.push(options?.streamOutput);
        options?.onOutputChunk?.('first chunk');
        options?.onOutputChunk?.('second chunk');

        return {
          output: 'first chunksecond chunk',
          exitCode: 0,
          agent: 'claude'
        };
      }
    };

    const resolver: ExecutorResolver = {
      async resolveExecutor(agentName) {
        expect(agentName).toBe('claude');
        return executor;
      },
      async getAgentAvailability() {
        return {
          claude: { agent: 'claude', available: true, command: 'claude' },
          codex: { agent: 'codex', available: false, command: 'codex' }
        };
      }
    };

    const runService = createRunService({ resolver });
    const server = createServer(
      createUiRouteHandler({
        cwd: projectDir,
        runService
      })
    );

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });

    try {
      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Test server did not bind to a TCP port.');
      }

      const response = await fetch(
        new URL(
          '/api/run/stream?skill=ui-stream-project&inputFile=./input.md&primaryAgent=claude',
          `http://127.0.0.1:${address.port}`
        ),
        {
          headers: {
            Accept: 'text/event-stream'
          }
        }
      );

      expect(response.ok).toBe(true);
      expect(response.headers.get('content-type')).toMatch(/^text\/event-stream/);

      const events = parseSse(await response.text());
      expect(
        events.filter((event) => event.event === 'output').map((event) => event.data)
      ).toEqual(['first chunk', 'second chunk']);

      const resultEvent = events.find((event) => event.event === 'result');
      expect(resultEvent).toBeDefined();
      expect(JSON.parse(resultEvent!.data)).toMatchObject({
        finalExitCode: 0,
        finalOutput: 'first chunksecond chunk'
      });
      expect(observedStreamOutput).toEqual([false]);
    } finally {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }
  });

  it('streams a structured failure event when execution throws', async () => {
    const projectDir = await createProject();
    const executor: Executor = {
      agent: 'claude',
      async run() {
        throw new Error('executor exploded');
      }
    };

    const resolver: ExecutorResolver = {
      async resolveExecutor() {
        return executor;
      },
      async getAgentAvailability() {
        return {
          claude: { agent: 'claude', available: true, command: 'claude' },
          codex: { agent: 'codex', available: false, command: 'codex' }
        };
      }
    };

    const runService = createRunService({ resolver });
    const server = createServer(
      createUiRouteHandler({
        cwd: projectDir,
        runService
      })
    );

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });

    try {
      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Test server did not bind to a TCP port.');
      }

      const response = await fetch(
        new URL(
          '/api/run/stream?skill=ui-stream-project&inputFile=./input.md&primaryAgent=claude',
          `http://127.0.0.1:${address.port}`
        ),
        {
          headers: {
            Accept: 'text/event-stream'
          }
        }
      );

      expect(response.ok).toBe(true);

      const events = parseSse(await response.text());
      const errorEvent = events.find((event) => event.event === 'run-error');
      expect(errorEvent).toBeDefined();
      expect(JSON.parse(errorEvent!.data)).toMatchObject({
        error: 'executor exploded'
      });
      expect(events.some((event) => event.event === 'error')).toBe(false);
    } finally {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }
  });
});

function parseSse(text: string): Array<{ event: string; data: string }> {
  const events: Array<{ event: string; data: string }> = [];
  let eventName = 'message';
  let dataLines: string[] = [];

  for (const line of text.split(/\r?\n/)) {
    if (line.length === 0) {
      if (dataLines.length > 0) {
        events.push({
          event: eventName,
          data: dataLines.join('\n')
        });
      }

      eventName = 'message';
      dataLines = [];
      continue;
    }

    if (line.startsWith('event:')) {
      eventName = line.slice('event:'.length).trim();
      continue;
    }

    if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).trimStart());
    }
  }

  return events;
}

async function createProject(): Promise<string> {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), 'brainctl-ui-run-stream-'));
  tempDirs.push(projectDir);

  await mkdir(path.join(projectDir, 'memory'), { recursive: true });
  await writeFile(
    path.join(projectDir, 'ai-stack.yaml'),
    [
      'memory:',
      '  paths:',
      '    - ./memory',
      'skills:',
      '  ui-stream-project:',
      '    description: Stream content for the UI test',
      '    prompt: |',
      '      Stream the following content chunk by chunk.',
      'mcps: {}'
    ].join('\n'),
    'utf8'
  );
  await writeFile(path.join(projectDir, 'input.md'), 'Draft the update.', 'utf8');

  return projectDir;
}
