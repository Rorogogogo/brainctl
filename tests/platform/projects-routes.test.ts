import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createUiRouteHandler } from '../../src/ui/routes.js';

const tempDirs: string[] = [];

async function startTestServer(deps: Parameters<typeof createUiRouteHandler>[0]): Promise<{
  url: string;
  close: () => Promise<void>;
}> {
  const handler = createUiRouteHandler(deps);
  const server: Server = createServer(async (req, res) => {
    try {
      await handler(req, res);
    } catch (err) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : 'Server error' }));
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const addr = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${addr.port}`;

  return {
    url,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe('projects routes', () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('GET /api/projects returns current, claudeProjects, and recents', async () => {
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'brainctl-proj-'));
    tempDirs.push(tmpDir);

    const claudeJsonPath = path.join(tmpDir, 'claude.json');
    const recentsFilePath = path.join(tmpDir, 'recents.json');

    await writeFile(
      claudeJsonPath,
      JSON.stringify({
        projects: {
          '/abs/b': {},
          '/abs/a': {},
        },
      }),
      'utf8'
    );

    await writeFile(
      recentsFilePath,
      JSON.stringify({ version: 1, recents: ['/abs/r1'] }),
      'utf8'
    );

    const server = await startTestServer({
      cwd: '/abs/current',
      claudeJsonPath,
      recentsFilePath,
    });

    try {
      const response = await fetch(new URL('/api/projects', server.url));
      expect(response.ok).toBe(true);
      const body = await response.json();
      expect(body).toEqual({
        current: '/abs/current',
        claudeProjects: ['/abs/a', '/abs/b'],
        recents: ['/abs/r1'],
      });
    } finally {
      await server.close();
    }
  });

  it('POST /api/projects/recent with absolute cwd returns 200 and updates recents file', async () => {
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'brainctl-proj-'));
    tempDirs.push(tmpDir);

    const recentsFilePath = path.join(tmpDir, 'recents.json');
    const claudeJsonPath = path.join(tmpDir, 'claude.json');

    // No pre-existing recents file; no claude.json needed for this test
    const server = await startTestServer({
      cwd: '/abs/current',
      claudeJsonPath,
      recentsFilePath,
    });

    try {
      const response = await fetch(new URL('/api/projects/recent', server.url), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cwd: '/abs/new' }),
      });
      expect(response.status).toBe(200);
      const body = await response.json() as { recents: string[] };
      expect(body.recents[0]).toBe('/abs/new');

      // Verify the file on disk
      const { readFile } = await import('node:fs/promises');
      const fileContent = JSON.parse(await readFile(recentsFilePath, 'utf8')) as { recents: string[] };
      expect(fileContent.recents[0]).toBe('/abs/new');
    } finally {
      await server.close();
    }
  });

  it('POST /api/projects/recent with relative path returns 400', async () => {
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'brainctl-proj-'));
    tempDirs.push(tmpDir);

    const recentsFilePath = path.join(tmpDir, 'recents.json');
    const claudeJsonPath = path.join(tmpDir, 'claude.json');

    const server = await startTestServer({
      cwd: '/abs/current',
      claudeJsonPath,
      recentsFilePath,
    });

    try {
      const response = await fetch(new URL('/api/projects/recent', server.url), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cwd: 'relative/path' }),
      });
      expect(response.status).toBe(400);
      const body = await response.json() as { error: string };
      expect(body.error).toBe('cwd must be an absolute path');
    } finally {
      await server.close();
    }
  });
});
