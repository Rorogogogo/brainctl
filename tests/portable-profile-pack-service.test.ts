import { execSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import YAML from 'yaml';
import { afterEach, describe, expect, it } from 'vitest';

import { createPortableProfilePackService } from '../src/services/portable-profile-pack-service.js';

describe('createPortableProfilePackService', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
    );
  });

  it('packs a Brainctl profile into a portable archive with manifest and redacted credentials', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'brainctl-pack-'));
    tempDirs.push(root);

    const cwd = path.join(root, 'workspace');
    await mkdir(cwd, { recursive: true });
    await mkdir(path.join(cwd, 'mcp-server'), { recursive: true });
    await writeFile(path.join(cwd, 'mcp-server', 'package.json'), '{"name":"mcp-server"}', 'utf8');

    const service = createPortableProfilePackService({
      profileService: {
        async get() {
          return {
            name: 'starter',
            skills: {},
            mcps: {
              github: {
                kind: 'local',
                source: 'npm',
                package: '@modelcontextprotocol/server-github',
                env: {
                  GITHUB_TOKEN: 'ghp_live_secret',
                },
              },
              bundle: {
                kind: 'local',
                source: 'bundled',
                path: './mcp-server',
                command: 'node',
              },
            },
            memory: {
              paths: ['./memory'],
            },
          };
        },
      },
    });

    const archivePath = path.join(cwd, 'starter.tar.gz');
    await service.execute({
      cwd,
      source: { source: 'profile', name: 'starter' },
      outputPath: archivePath,
    });

    const extractDir = await mkdtemp(path.join(os.tmpdir(), 'brainctl-pack-extract-'));
    tempDirs.push(extractDir);
    execSync(`tar -xzf "${archivePath}" -C "${extractDir}"`);

    const manifest = YAML.parse(await readFile(path.join(extractDir, 'manifest.yaml'), 'utf8')) as Record<
      string,
      unknown
    >;
    const profile = YAML.parse(await readFile(path.join(extractDir, 'profile.yaml'), 'utf8')) as Record<
      string,
      any
    >;

    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.profileName).toBe('starter');
    expect(manifest.createdBy).toEqual({
      tool: 'brainctl',
      version: '0.1.6',
    });
    expect(manifest.credentials).toEqual([
      expect.objectContaining({
        key: 'github_token',
        required: true,
      }),
    ]);
    expect(profile.mcps.github.env.GITHUB_TOKEN).toBe('${credentials.github_token}');
    expect(profile.mcps.bundle.path).toBe('./mcps/bundle');
    await expect(readFile(path.join(extractDir, 'mcps', 'bundle', 'package.json'), 'utf8')).resolves.toContain(
      '"name":"mcp-server"'
    );
    await expect(readFile(path.join(extractDir, 'profile.yaml'), 'utf8')).resolves.not.toContain(
      'ghp_live_secret'
    );
  });

  it.each(['claude', 'codex', 'gemini'] as const)(
    'packs a live %s agent config via classifier output',
    async (agent) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'brainctl-agent-pack-'));
    tempDirs.push(root);

    const cwd = path.join(root, 'workspace');
    await mkdir(cwd, { recursive: true });

    const service = createPortableProfilePackService({
      agentConfigService: {
        async readAll() {
          return [
            {
              agent: 'claude',
              configPath: '/tmp/.claude.json',
              exists: true,
              mcpServers: {
                github: {
                  command: 'npx',
                  args: ['-y', '@modelcontextprotocol/server-github'],
                  env: {
                    GITHUB_TOKEN: 'ghp_live_secret',
                  },
                },
              },
              remoteMcpServers: {},
              skills: [],
            },
            {
              agent: 'codex',
              configPath: '/tmp/.codex/config.toml',
              exists: true,
              mcpServers: {
                docs: {
                  command: 'npx',
                  args: ['-y', '@modelcontextprotocol/server-filesystem', cwd],
                },
              },
              remoteMcpServers: {},
              skills: [],
            },
            {
              agent: 'gemini',
              configPath: '/tmp/.gemini/settings.json',
              exists: true,
              mcpServers: {},
              remoteMcpServers: {
                search: {
                  transport: 'http',
                  url: 'https://mcp.example.com',
                  headers: {
                    Authorization: 'Bearer live-secret',
                  },
                },
              },
              skills: [],
            },
          ];
        },
      },
    });

    const archivePath = path.join(cwd, `workspace-${agent}.tar.gz`);
    await service.execute({
      cwd,
      source: { source: 'agent', agent, cwd },
      outputPath: archivePath,
    });

    const extractDir = await mkdtemp(path.join(os.tmpdir(), 'brainctl-agent-pack-extract-'));
    tempDirs.push(extractDir);
    execSync(`tar -xzf "${archivePath}" -C "${extractDir}"`);

    const manifest = YAML.parse(await readFile(path.join(extractDir, 'manifest.yaml'), 'utf8')) as Record<
      string,
      any
    >;
    const profile = YAML.parse(await readFile(path.join(extractDir, 'profile.yaml'), 'utf8')) as Record<
      string,
      any
    >;

    expect(manifest.source).toEqual({
      kind: 'agent',
      agent,
    });
    expect(manifest.createdBy).toEqual({
      tool: 'brainctl',
      version: '0.1.6',
    });
    expect(profile.name).toBe(`workspace-${agent}`);
    if (agent === 'claude') {
      expect(profile.mcps.github).toEqual({
        kind: 'local',
        source: 'npm',
        package: '@modelcontextprotocol/server-github',
        env: {
          GITHUB_TOKEN: '${credentials.github_token}',
        },
      });
    } else if (agent === 'codex') {
      expect(profile.mcps.docs).toEqual({
        kind: 'local',
        source: 'npm',
        package: '@modelcontextprotocol/server-filesystem',
      });
    } else {
      expect(profile.mcps.search).toEqual({
        kind: 'remote',
        transport: 'http',
        url: 'https://mcp.example.com',
        headers: {
          Authorization: '${credentials.authorization}',
        },
      });
    }
    await expect(readFile(path.join(extractDir, 'profile.yaml'), 'utf8')).resolves.not.toContain(
      'ghp_live_secret'
    );
    await expect(readFile(path.join(extractDir, 'profile.yaml'), 'utf8')).resolves.not.toContain(
      'live-secret'
    );
  });
});
