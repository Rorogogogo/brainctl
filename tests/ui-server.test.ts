import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
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

  it('returns 400 for invalid config bodies without overwriting ai-stack.yaml', async () => {
    const projectDir = await mkdtemp(path.join(os.tmpdir(), 'brainctl-ui-'));
    tempDirs.push(projectDir);

    await mkdir(path.join(projectDir, 'memory'), { recursive: true });
    const configPath = path.join(projectDir, 'ai-stack.yaml');
    const originalContents = [
      'memory:',
      '  paths:',
      '    - ./memory',
      'skills:',
      '  summarize:',
      '    description: Summarize content',
      '    prompt: |',
      '      Summarize the following content into concise bullet points.',
      'mcps: {}'
    ].join('\n');
    await writeFile(configPath, originalContents, 'utf8');

    const server = await startUiServer({ cwd: projectDir, port: 0 });

    try {
      const response = await fetch(new URL('/api/config', server.url), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          memory: {
            paths: ['./memory']
          },
          skills: {
            summarize: {
              description: 'Summarize content'
            }
          },
          mcps: {}
        })
      });

      expect(response.status).toBe(400);
      expect(response.headers.get('content-type')).toContain('application/json');
      await expect(response.json()).resolves.toMatchObject({ error: expect.any(String) });
      await expect(readFile(configPath, 'utf8')).resolves.toBe(originalContents);
    } finally {
      await server.close();
    }
  });

  it('returns 400 for config writes with memory paths outside the workspace root', async () => {
    const projectDir = await mkdtemp(path.join(os.tmpdir(), 'brainctl-ui-'));
    tempDirs.push(projectDir);

    const outsideDir = await mkdtemp(path.join(os.tmpdir(), 'brainctl-ui-outside-'));
    tempDirs.push(outsideDir);

    await mkdir(path.join(projectDir, 'memory'), { recursive: true });
    const configPath = path.join(projectDir, 'ai-stack.yaml');
    const originalContents = [
      'memory:',
      '  paths:',
      '    - ./memory',
      'skills:',
      '  summarize:',
      '    description: Summarize content',
      '    prompt: |',
      '      Summarize the following content into concise bullet points.',
      'mcps: {}'
    ].join('\n');
    await writeFile(configPath, originalContents, 'utf8');

    const server = await startUiServer({ cwd: projectDir, port: 0 });

    try {
      const response = await fetch(new URL('/api/config', server.url), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          memory: {
            paths: [path.join(outsideDir, 'memory')]
          },
          skills: {
            summarize: {
              description: 'Summarize content',
              prompt: 'Summarize the following content into concise bullet points.'
            }
          },
          mcps: {}
        })
      });

      expect(response.status).toBe(400);
      expect(response.headers.get('content-type')).toContain('application/json');
      await expect(response.json()).resolves.toEqual({
        error: 'Memory paths must stay within the workspace root.'
      });
      await expect(readFile(configPath, 'utf8')).resolves.toBe(originalContents);
    } finally {
      await server.close();
    }
  });

  it('returns 400 Invalid JSON body for malformed or empty PUT /api/config payloads', async () => {
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
      const malformedResponse = await fetch(new URL('/api/config', server.url), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: '{'
      });

      expect(malformedResponse.status).toBe(400);
      await expect(malformedResponse.json()).resolves.toEqual({
        error: 'Invalid JSON body'
      });

      const emptyResponse = await fetch(new URL('/api/config', server.url), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: ''
      });

      expect(emptyResponse.status).toBe(400);
      await expect(emptyResponse.json()).resolves.toEqual({
        error: 'Invalid JSON body'
      });
    } finally {
      await server.close();
    }
  });

  it('maps invalid on-disk config reads to a 400 JSON response', async () => {
    const projectDir = await mkdtemp(path.join(os.tmpdir(), 'brainctl-ui-'));
    tempDirs.push(projectDir);

    await mkdir(path.join(projectDir, 'memory'), { recursive: true });
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

    const server = await startUiServer({ cwd: projectDir, port: 0 });

    try {
      const response = await fetch(new URL('/api/config', server.url));
      expect(response.status).toBe(400);
      expect(response.headers.get('content-type')).toContain('application/json');
      await expect(response.json()).resolves.toEqual({
        error: 'ai-stack.yaml is missing the required "skills" section.'
      });
    } finally {
      await server.close();
    }
  });

  it('persists config updates through PUT /api/config and returns the saved JSON', async () => {
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
    const updatedConfig = {
      memory: {
        paths: ['./memory']
      },
      skills: {
        summarize: {
          description: 'Summarize content',
          prompt: 'Summarize the following content into concise bullet points.'
        },
        research: {
          description: 'Research content',
          prompt: 'Research the following topic and return key findings.'
        }
      },
      mcps: {
        github: {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-github']
        }
      }
    };

    try {
      const response = await fetch(new URL('/api/config', server.url), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(updatedConfig)
      });

      expect(response.ok).toBe(true);
      expect(response.headers.get('content-type')).toContain('application/json');
      await expect(response.json()).resolves.toMatchObject({
        configPath: path.join(projectDir, 'ai-stack.yaml'),
        rootDir: projectDir,
        memory: {
          paths: [path.join(projectDir, 'memory')]
        },
        skills: updatedConfig.skills,
        mcps: updatedConfig.mcps
      });

      const diskConfigResponse = await fetch(new URL('/api/config', server.url));
      expect(diskConfigResponse.ok).toBe(true);
      await expect(diskConfigResponse.json()).resolves.toMatchObject({
        memory: {
          paths: [path.join(projectDir, 'memory')]
        },
        skills: updatedConfig.skills,
        mcps: updatedConfig.mcps
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
});
