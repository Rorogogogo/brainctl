import { execSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { startUiServer } from '../../src/ui/server.js';

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

  it('serves the built frontend entrypoint and static assets from /', async () => {
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

    const server = await startUiServer({ cwd: projectDir, port: 0 });

    try {
      const response = await fetch(new URL('/', server.url));
      expect(response.ok).toBe(true);
      expect(response.headers.get('content-type')).toContain('text/html');

      const html = await response.text();
      expect(html).toContain('<div id="root"></div>');

      const scriptMatch = html.match(/<script type="module" crossorigin src="([^"]+)"/);
      const styleMatch = html.match(/<link rel="stylesheet" crossorigin href="([^"]+)"/);
      expect(scriptMatch?.[1]).toMatch(/^\/assets\/.+\.js$/);
      expect(styleMatch?.[1]).toMatch(/^\/assets\/.+\.css$/);

      const scriptResponse = await fetch(new URL(scriptMatch![1], server.url));
      expect(scriptResponse.ok).toBe(true);
      expect(scriptResponse.headers.get('content-type')).toContain('javascript');

      const styleResponse = await fetch(new URL(styleMatch![1], server.url));
      expect(styleResponse.ok).toBe(true);
      expect(styleResponse.headers.get('content-type')).toContain('css');
    } finally {
      await server.close();
    }
  });

  it('returns a JSON 404 for unknown api routes', async () => {
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

    const server = await startUiServer({ cwd: projectDir, port: 0 });

    try {
      const response = await fetch(new URL('/api/does-not-exist', server.url));
      expect(response.status).toBe(404);
      expect(response.headers.get('content-type')).toContain('application/json');
      await expect(response.json()).resolves.toEqual({ error: 'Not found' });
    } finally {
      await server.close();
    }
  });

  it('rejects PUT on non-config api routes with 405', async () => {
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

    const server = await startUiServer({ cwd: projectDir, port: 0 });

    try {
      const response = await fetch(new URL('/api/overview', server.url), {
        method: 'PUT'
      });

      expect(response.status).toBe(405);
      expect(response.headers.get('content-type')).toContain('application/json');
      await expect(response.json()).resolves.toEqual({ error: 'Method not allowed' });
    } finally {
      await server.close();
    }
  });

  it('rejects PUT / as a method not allowed response instead of serving the SPA', async () => {
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

    const server = await startUiServer({ cwd: projectDir, port: 0 });

    try {
      const response = await fetch(new URL('/', server.url), {
        method: 'PUT'
      });

      expect(response.status).toBe(405);
      expect(response.headers.get('content-type')).toContain('application/json');
      await expect(response.json()).resolves.toEqual({ error: 'Method not allowed' });
    } finally {
      await server.close();
    }
  });


  it('returns MCP preflight results without mutating agent config files', async () => {
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

    const server = await startUiServer({ cwd: projectDir, port: 0 });

    try {
      const response = await fetch(new URL('/api/agents/codex/mcps/check', server.url), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          key: 'local-server',
          entry: {
            command: 'node',
            args: ['./missing-server.js']
          }
        })
      });

      expect(response.ok).toBe(true);
      await expect(response.json()).resolves.toMatchObject({
        ok: false,
        checks: expect.arrayContaining([
          expect.objectContaining({
            label: 'Entrypoint',
            status: 'error'
          })
        ])
      });
    } finally {
      await server.close();
    }
  });

  it('rejects MCP writes that fail preflight validation', async () => {
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

    const server = await startUiServer({ cwd: projectDir, port: 0 });

    try {
      const response = await fetch(new URL('/api/agents/claude/mcps', server.url), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          key: 'local-server',
          entry: {
            command: 'node',
            args: ['./missing-server.js']
          }
        })
      });

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error:
          'MCP "local-server" cannot be added to claude: Entrypoint script was not found: ' +
          path.join(projectDir, 'missing-server.js')
      });
    } finally {
      await server.close();
    }
  });

  it('returns skill preflight results for unsupported plugin-backed entries', async () => {
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

    const server = await startUiServer({ cwd: projectDir, port: 0 });

    try {
      const response = await fetch(new URL('/api/agents/codex/skills/check', server.url), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: 'github',
          sourceAgent: 'claude',
          source: 'claude-plugins-official'
        })
      });

      expect(response.ok).toBe(true);
      await expect(response.json()).resolves.toMatchObject({
        ok: false,
        checks: expect.arrayContaining([
          expect.objectContaining({
            label: 'Source',
            status: 'error'
          })
        ])
      });
    } finally {
      await server.close();
    }
  });

  it('rejects skill writes that fail preflight validation', async () => {
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

    const server = await startUiServer({ cwd: projectDir, port: 0 });

    try {
      const response = await fetch(new URL('/api/agents/gemini/skills', server.url), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: 'github',
          sourceAgent: 'claude',
          source: 'claude-plugins-official'
        })
      });

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error:
          'Skill "github" cannot be copied from claude to gemini: ' +
          'Only local skill folders can be copied today. "github" is a plugin/managed entry from claude-plugins-official.'
      });
    } finally {
      await server.close();
    }
  });

  it('rejects asset path traversal attempts', async () => {
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

    const server = await startUiServer({ cwd: projectDir, port: 0 });

    try {
      const response = await fetch(new URL('/assets/../../package.json', server.url));
      expect(response.status).toBe(404);
      expect(response.headers.get('content-type')).toContain('text/plain');
    } finally {
      await server.close();
    }
  });

  it('exports a profile archive through the web api', async () => {
    const projectDir = await mkdtemp(path.join(os.tmpdir(), 'brainctl-ui-'));
    tempDirs.push(projectDir);

    await mkdir(path.join(projectDir, 'memory'), { recursive: true });
    await mkdir(path.join(projectDir, '.brainctl', 'profiles'), { recursive: true });
    await writeFile(
      path.join(projectDir, 'ai-stack.yaml'),
      ['memory:', '  paths:', '    - ./memory', 'skills: {}', 'mcps: {}'].join('\n'),
      'utf8'
    );
    await writeFile(
      path.join(projectDir, '.brainctl', 'profiles', 'starter.yaml'),
      [
        'name: starter',
        'skills:',
        '  notes:',
        '    description: Keep notes',
        '    prompt: |',
        '      Write notes.',
        'mcps: {}',
        'memory:',
        '  paths:',
        '    - ./memory',
      ].join('\n'),
      'utf8'
    );

    const server = await startUiServer({ cwd: projectDir, port: 0 });

    try {
      const response = await fetch(new URL('/api/profiles/export', server.url), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'starter' }),
      });

      expect(response.ok).toBe(true);
      const result = await response.json();
      expect(result.archivePath).toBe(path.join(projectDir, 'starter.tar.gz'));

      const archive = await readFile(result.archivePath, 'utf8').catch(() => null);
      expect(archive).not.toBeNull();
    } finally {
      await server.close();
    }
  });

  it('returns a saved profile through the web api for pack preview', async () => {
    const projectDir = await mkdtemp(path.join(os.tmpdir(), 'brainctl-ui-'));
    tempDirs.push(projectDir);

    await mkdir(path.join(projectDir, 'memory'), { recursive: true });
    await mkdir(path.join(projectDir, '.brainctl', 'profiles'), { recursive: true });
    await writeFile(
      path.join(projectDir, 'ai-stack.yaml'),
      ['memory:', '  paths:', '    - ./memory', 'skills: {}', 'mcps: {}'].join('\n'),
      'utf8'
    );
    await writeFile(
      path.join(projectDir, '.brainctl', 'profiles', 'starter.yaml'),
      [
        'name: starter',
        'skills:',
        '  review:',
        '    description: Review code',
        '    prompt: |',
        '      Review the code.',
        'mcps:',
        '  github:',
        '    kind: local',
        '    source: npm',
        '    package: "@modelcontextprotocol/server-github"',
        'memory:',
        '  paths:',
        '    - ./memory',
      ].join('\n'),
      'utf8'
    );

    const server = await startUiServer({ cwd: projectDir, port: 0 });

    try {
      const response = await fetch(new URL('/api/profiles/starter', server.url));
      expect(response.ok).toBe(true);
      await expect(response.json()).resolves.toMatchObject({
        name: 'starter',
        mcps: {
          github: {
            kind: 'local',
            source: 'npm',
          },
        },
      });
    } finally {
      await server.close();
    }
  });

  it('imports a profile archive through the web api', async () => {
    const projectDir = await mkdtemp(path.join(os.tmpdir(), 'brainctl-ui-'));
    tempDirs.push(projectDir);

    await mkdir(path.join(projectDir, 'memory'), { recursive: true });
    await writeFile(
      path.join(projectDir, 'ai-stack.yaml'),
      ['memory:', '  paths:', '    - ./memory', 'skills: {}', 'mcps: {}'].join('\n'),
      'utf8'
    );

    const archiveStageDir = await mkdtemp(path.join(os.tmpdir(), 'brainctl-archive-'));
    tempDirs.push(archiveStageDir);
    await writeFile(
      path.join(archiveStageDir, 'manifest.yaml'),
      [
        'schemaVersion: 1',
        'profileName: imported',
        'source:',
        '  kind: profile',
        '  profileName: imported',
      ].join('\n'),
      'utf8'
    );
    await writeFile(
      path.join(archiveStageDir, 'profile.yaml'),
      [
        'name: imported',
        'skills:',
        '  review:',
        '    description: Review code',
        '    prompt: |',
        '      Review the code.',
        'mcps: {}',
        'memory:',
        '  paths:',
        '    - ./memory',
      ].join('\n'),
      'utf8'
    );

    const archivePath = path.join(projectDir, 'imported.tar.gz');
    execSync(`tar -czf "${archivePath}" -C "${archiveStageDir}" .`);

    const server = await startUiServer({ cwd: projectDir, port: 0 });

    try {
      const response = await fetch(new URL('/api/profiles/import', server.url), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archivePath }),
      });

      expect(response.ok).toBe(true);
      await expect(response.json()).resolves.toEqual({
        profileName: 'imported',
        installedMcps: [],
        installedPlugins: [],
        installedUserSkills: [],
      });

      const profileSource = await readFile(
        path.join(projectDir, '.brainctl', 'profiles', 'imported', 'profile.yaml'),
        'utf8'
      );
      expect(profileSource).toContain('name: imported');
    } finally {
      await server.close();
    }
  });

  it('imports a profile archive with credentials through the web api', async () => {
    const projectDir = await mkdtemp(path.join(os.tmpdir(), 'brainctl-ui-'));
    tempDirs.push(projectDir);

    await mkdir(path.join(projectDir, 'memory'), { recursive: true });
    await writeFile(
      path.join(projectDir, 'ai-stack.yaml'),
      ['memory:', '  paths:', '    - ./memory', 'skills: {}', 'mcps: {}'].join('\n'),
      'utf8'
    );

    const archiveStageDir = await mkdtemp(path.join(os.tmpdir(), 'brainctl-archive-'));
    tempDirs.push(archiveStageDir);
    await writeFile(
      path.join(archiveStageDir, 'manifest.yaml'),
      [
        'schemaVersion: 1',
        'profileName: imported',
        'credentials:',
        '  - key: github_token',
        '    required: true',
        'source:',
        '  kind: profile',
        '  profileName: imported',
      ].join('\n'),
      'utf8'
    );
    await writeFile(
      path.join(archiveStageDir, 'profile.yaml'),
      [
        'name: imported',
        'skills:',
        '  review:',
        '    description: Review code',
        '    prompt: |',
        '      Review the code.',
        'mcps:',
        '  github:',
        '    kind: local',
        '    source: npm',
        '    package: "@modelcontextprotocol/server-github"',
        '    env:',
        '      GITHUB_TOKEN: ${credentials.github_token}',
        'memory:',
        '  paths:',
        '    - ./memory',
      ].join('\n'),
      'utf8'
    );

    const archivePath = path.join(projectDir, 'imported.tar.gz');
    execSync(`tar -czf "${archivePath}" -C "${archiveStageDir}" .`);

    const server = await startUiServer({ cwd: projectDir, port: 0 });

    try {
      const response = await fetch(new URL('/api/profiles/import', server.url), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          archivePath,
          credentials: {
            github_token: 'ghp_live_secret',
          },
        }),
      });

      expect(response.ok).toBe(true);
      await expect(response.json()).resolves.toEqual({
        profileName: 'imported',
        installedMcps: [],
        installedPlugins: [],
        installedUserSkills: [],
      });

      const profileSource = await readFile(
        path.join(projectDir, '.brainctl', 'profiles', 'imported', 'profile.yaml'),
        'utf8'
      );
      expect(profileSource).toContain('GITHUB_TOKEN: ghp_live_secret');
    } finally {
      await server.close();
    }
  });
});
