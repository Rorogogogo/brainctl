import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
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

import { createAgentConfigService } from '../../src/services/agent/agent-config-service.js';

describe('agent config service', () => {
  let homeDir: string;

  beforeEach(async () => {
    homeDir = await mkdtemp(path.join(os.tmpdir(), 'brainctl-agent-config-'));
    mockHomedir.mockReturnValue(homeDir);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('adds a remote Claude MCP to the project config', async () => {
    const cwd = '/tmp/project';
    await writeFile(
      path.join(homeDir, '.claude.json'),
      JSON.stringify({ projects: { [cwd]: { mcpServers: {} } } }, null, 2),
      'utf8'
    );

    const service = createAgentConfigService();
    await service.addMcp({
      cwd,
      agent: 'claude',
      key: 'docs',
      scope: 'project',
      remoteEntry: {
        transport: 'http',
        url: 'https://developers.openai.com/mcp',
        headers: {
          Authorization: 'Bearer token',
        },
      },
    });

    const saved = JSON.parse(await readFile(path.join(homeDir, '.claude.json'), 'utf8')) as {
      projects: Record<string, { mcpServers: Record<string, unknown> }>;
    };

    expect(saved.projects[cwd].mcpServers.docs).toEqual({
      type: 'http',
      url: 'https://developers.openai.com/mcp',
      headers: {
        Authorization: 'Bearer token',
      },
    });
  });

  it('adds a remote Codex MCP as a url entry', async () => {
    const configDir = path.join(homeDir, '.codex');
    await mkdir(configDir, { recursive: true });
    await writeFile(path.join(configDir, 'config.toml'), 'model = "gpt-5.4"\n', 'utf8');

    const service = createAgentConfigService();
    await service.addMcp({
      cwd: '/tmp/project',
      agent: 'codex',
      key: 'docs',
      remoteEntry: {
        transport: 'http',
        url: 'https://developers.openai.com/mcp',
      },
    });

    const saved = await readFile(path.join(configDir, 'config.toml'), 'utf8');
    expect(saved).toContain('[mcp_servers.docs]');
    expect(saved).toContain('url = "https://developers.openai.com/mcp"');
  });

  it('writes Antigravity MCP changes to the global settings file', async () => {
    const cwd = path.join(homeDir, 'workspace');
    await mkdir(path.join(homeDir, '.gemini', 'antigravity-cli'), { recursive: true });
    await writeFile(
      path.join(homeDir, '.gemini', 'antigravity-cli', 'mcp_config.json'),
      JSON.stringify({ mcpServers: {} }, null, 2),
      'utf8'
    );

    const service = createAgentConfigService();
    await service.addMcp({
      cwd,
      agent: 'antigravity',
      key: 'docs',
      remoteEntry: {
        transport: 'http',
        url: 'https://developers.openai.com/mcp',
        headers: {
          Authorization: 'Bearer token',
        },
      },
    });

    const saved = JSON.parse(
      await readFile(path.join(homeDir, '.gemini', 'antigravity-cli', 'mcp_config.json'), 'utf8')
    ) as {
      mcpServers: Record<string, unknown>;
    };

    expect(saved.mcpServers.docs).toEqual({
      httpUrl: 'https://developers.openai.com/mcp',
      headers: {
        Authorization: 'Bearer token',
      },
    });
  });

  describe('moveSkillScope (claude)', () => {
    it('moves a user-scope skill directory into project scope', async () => {
      const cwd = await mkdtemp(path.join(os.tmpdir(), 'brainctl-move-cwd-'));
      const userSkill = path.join(homeDir, '.claude', 'skills', 'lint');
      await mkdir(userSkill, { recursive: true });
      await writeFile(path.join(userSkill, 'SKILL.md'), '---\nname: lint\n---\n', 'utf8');

      const service = createAgentConfigService();
      await service.moveSkillScope({
        cwd,
        agent: 'claude',
        skillName: 'lint',
        fromScope: 'user',
        toScope: 'project',
      });

      const newPath = path.join(cwd, '.claude', 'skills', 'lint', 'SKILL.md');
      await expect(readFile(newPath, 'utf8')).resolves.toContain('name: lint');
      await expect(readFile(path.join(userSkill, 'SKILL.md'), 'utf8')).rejects.toThrow();

      // Idempotent: running again with the same args succeeds (already at dest).
      await service.moveSkillScope({
        cwd,
        agent: 'claude',
        skillName: 'lint',
        fromScope: 'user',
        toScope: 'project',
      });
    });

    it('moves a project-scope skill into user scope', async () => {
      const cwd = await mkdtemp(path.join(os.tmpdir(), 'brainctl-move-cwd2-'));
      const projSkill = path.join(cwd, '.claude', 'skills', 'fmt');
      await mkdir(projSkill, { recursive: true });
      await writeFile(path.join(projSkill, 'SKILL.md'), '---\nname: fmt\n---\n', 'utf8');

      const service = createAgentConfigService();
      await service.moveSkillScope({
        cwd,
        agent: 'claude',
        skillName: 'fmt',
        fromScope: 'project',
        toScope: 'user',
      });

      const dest = path.join(homeDir, '.claude', 'skills', 'fmt', 'SKILL.md');
      await expect(readFile(dest, 'utf8')).resolves.toContain('name: fmt');
      await expect(readFile(path.join(projSkill, 'SKILL.md'), 'utf8')).rejects.toThrow();
    });

    it('rejects move-scope for codex or antigravity', async () => {
      const service = createAgentConfigService();
      await expect(
        service.moveSkillScope({
          cwd: '/tmp',
          agent: 'codex',
          skillName: 'x',
          fromScope: 'user',
          toScope: 'project',
        })
      ).rejects.toThrow(/only supported for Claude/i);
    });
  });
});
