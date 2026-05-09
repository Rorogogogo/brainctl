import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockHomedir } = vi.hoisted(() => ({
  mockHomedir: vi.fn(),
}));

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os');
  return {
    ...actual,
    homedir: mockHomedir,
  };
});

import { startUiServer } from '../../src/ui/server.js';

const tempDirs: string[] = [];

describe('ui snapshot progress', () => {
  const originalBrainctlHome = process.env.BRAINCTL_HOME;
  let homeDir: string;

  beforeEach(async () => {
    homeDir = await mkdtemp(path.join(os.tmpdir(), 'brainctl-home-'));
    tempDirs.push(homeDir);
    mockHomedir.mockReturnValue(homeDir);
    process.env.BRAINCTL_HOME = homeDir;
  });

  afterEach(async () => {
    if (originalBrainctlHome === undefined) delete process.env.BRAINCTL_HOME;
    else process.env.BRAINCTL_HOME = originalBrainctlHome;
    vi.clearAllMocks();
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('streams snapshot progress events before the final result', async () => {
    const projectDir = await mkdtemp(path.join(os.tmpdir(), 'brainctl-project-'));
    tempDirs.push(projectDir);
    await writeFile(path.join(homeDir, '.claude.json'), JSON.stringify({ mcpServers: {} }), 'utf8');

    const server = await startUiServer({ cwd: projectDir, port: 0 });

    try {
      const response = await fetch(new URL('/api/profiles/snapshot', server.url), {
        method: 'POST',
        headers: {
          accept: 'application/x-ndjson',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ agent: 'claude', as: 'from-claude' }),
      });

      expect(response.ok).toBe(true);
      expect(response.headers.get('content-type')).toContain('application/x-ndjson');

      const events = (await response.text())
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as { type: string; message?: string; profileName?: string });

      expect(events.some((event) => event.type === 'progress')).toBe(true);
      expect(events.map((event) => event.message)).toContain('Reading claude config and skills…');
      expect(events.at(-1)).toMatchObject({
        type: 'result',
        profileName: 'from-claude',
      });
    } finally {
      await server.close();
    }
  });
});
