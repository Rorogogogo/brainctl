import { createServer } from 'node:http';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createUiRouteHandler } from '../src/ui/routes.js';

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
    const server = createServer(
      createUiRouteHandler({
        cwd: projectDir,
        runService: {
          async execute(_request: unknown, hooks?: { onOutputChunk?: (chunk: string) => void }) {
            hooks?.onOutputChunk?.('first chunk');
            hooks?.onOutputChunk?.('second chunk');

            return {
              steps: [
                {
                  stepIndex: 0,
                  requestedAgent: 'claude',
                  agent: 'claude',
                  fallbackUsed: false,
                  exitCode: 0,
                  output: 'second chunk'
                }
              ],
              finalOutput: 'second chunk',
              finalExitCode: 0
            };
          }
        } as any
      } as any)
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
          '/api/run/stream?skill=summarize&inputFile=./input.md&primaryAgent=claude',
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
        finalOutput: 'second chunk'
      });
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
      '  summarize:',
      '    description: Summarize content',
      '    prompt: |',
      '      Summarize the following content into concise bullet points.',
      'mcps: {}'
    ].join('\n'),
    'utf8'
  );
  await writeFile(path.join(projectDir, 'input.md'), 'Draft the update.', 'utf8');

  return projectDir;
}
