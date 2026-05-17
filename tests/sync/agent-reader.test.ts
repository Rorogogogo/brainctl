import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
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

import {
  createClaudeReader,
  createCodexReader,
  createGeminiReader,
} from '../../src/services/sync/agent-reader.js';

describe('agent readers', () => {
  let homeDir: string;

  beforeEach(async () => {
    homeDir = await mkdtemp(path.join(os.tmpdir(), 'brainctl-agent-reader-'));
    mockHomedir.mockReturnValue(homeDir);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('reads local and remote Claude MCPs into separate maps', async () => {
    const cwd = '/tmp/project';
    await writeFile(
      path.join(homeDir, '.claude.json'),
      JSON.stringify(
        {
          projects: {
            [cwd]: {
              mcpServers: {
                github: {
                  type: 'stdio',
                  command: 'npx',
                  args: ['-y', '@modelcontextprotocol/server-github'],
                },
                docs: {
                  type: 'http',
                  url: 'https://developers.openai.com/mcp',
                  headers: {
                    Authorization: 'Bearer token',
                  },
                },
              },
            },
          },
        },
        null,
        2
      ),
      'utf8'
    );

    const result = await createClaudeReader().read({ cwd });

    // Claude project-scoped servers (under projects[cwd].mcpServers) flow into
    // the projectMcpServers / projectRemoteMcpServers maps; the global maps
    // come from the top-level mcpServers field, which is empty here.
    expect(result.mcpServers).toEqual({});
    expect(result.remoteMcpServers).toEqual({});
    expect(result.projectMcpServers).toEqual({
      github: {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-github'],
      },
    });
    expect(result.projectRemoteMcpServers).toEqual({
      docs: {
        transport: 'http',
        url: 'https://developers.openai.com/mcp',
        headers: {
          Authorization: 'Bearer token',
        },
      },
    });
  });

  it('reads local and remote Codex MCPs into separate maps', async () => {
    const configDir = path.join(homeDir, '.codex');
    await mkdir(configDir, { recursive: true });
    await writeFile(
      path.join(configDir, 'config.toml'),
      [
        '[mcp_servers.github]',
        'command = "npx"',
        'args = ["-y", "@modelcontextprotocol/server-github"]',
        '',
        '[mcp_servers.docs]',
        'url = "https://developers.openai.com/mcp"',
      ].join('\n'),
      'utf8'
    );

    const result = await createCodexReader().read({ cwd: '/tmp/project' });

    expect(result.mcpServers).toEqual({
      github: {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-github'],
      },
    });
    expect(result.remoteMcpServers).toEqual({
      docs: {
        transport: 'http',
        url: 'https://developers.openai.com/mcp',
      },
    });
  });

  it('discovers Claude project skills via ancestor walk and tags them scope=project', async () => {
    // Workspace layout: <repo>/.git, <repo>/sub/cwd/, <repo>/.claude/skills/<name>
    const repo = await mkdtemp(path.join(os.tmpdir(), 'brainctl-project-skills-repo-'));
    await mkdir(path.join(repo, '.git'), { recursive: true });
    const cwd = path.join(repo, 'sub', 'inner');
    await mkdir(cwd, { recursive: true });

    const skillDir = path.join(repo, '.claude', 'skills', 'project-only');
    await mkdir(skillDir, { recursive: true });
    await writeFile(path.join(skillDir, 'SKILL.md'), '---\nname: project-only\n---\n', 'utf8');

    // Also drop a user-scoped skill in ~/.claude/skills/ to verify both flow through.
    const userSkillDir = path.join(homeDir, '.claude', 'skills', 'user-only');
    await mkdir(userSkillDir, { recursive: true });
    await writeFile(path.join(userSkillDir, 'SKILL.md'), '---\nname: user-only\n---\n', 'utf8');

    const result = await createClaudeReader().read({ cwd });

    const byName = Object.fromEntries(result.skills.map((s) => [s.name, s]));
    expect(byName['project-only']).toMatchObject({ scope: 'project', kind: 'skill', source: 'local' });
    expect(byName['user-only']).toMatchObject({ scope: 'user', kind: 'skill', source: 'local' });
  });

  it('stops the ancestor walk at the first .git directory', async () => {
    // outer/.git exists; outer/.claude/skills/<name> should NOT be picked up
    // because the walk stops at inner/.git, which is the closer repo root.
    const outer = await mkdtemp(path.join(os.tmpdir(), 'brainctl-outer-'));
    await mkdir(path.join(outer, '.git'), { recursive: true });
    const outerSkill = path.join(outer, '.claude', 'skills', 'outer-skill');
    await mkdir(outerSkill, { recursive: true });

    const inner = path.join(outer, 'inner');
    await mkdir(path.join(inner, '.git'), { recursive: true });
    const innerSkill = path.join(inner, '.claude', 'skills', 'inner-skill');
    await mkdir(innerSkill, { recursive: true });

    const cwd = path.join(inner, 'work');
    await mkdir(cwd, { recursive: true });

    const result = await createClaudeReader().read({ cwd });
    const names = result.skills.map((s) => s.name);
    expect(names).toContain('inner-skill');
    expect(names).not.toContain('outer-skill');
  });

  it('does not project-walk for codex or gemini readers', async () => {
    const repo = await mkdtemp(path.join(os.tmpdir(), 'brainctl-no-project-walk-'));
    await mkdir(path.join(repo, '.git'), { recursive: true });
    await mkdir(path.join(repo, '.claude', 'skills', 'should-not-show'), { recursive: true });

    const codexResult = await createCodexReader().read({ cwd: repo });
    const geminiResult = await createGeminiReader().read({ cwd: repo });
    expect(codexResult.skills.find((s) => s.name === 'should-not-show')).toBeUndefined();
    expect(geminiResult.skills.find((s) => s.name === 'should-not-show')).toBeUndefined();
    // Every emitted skill (if any) must be user-scoped for codex/gemini.
    for (const s of codexResult.skills) expect(s.scope).toBe('user');
    for (const s of geminiResult.skills) expect(s.scope).toBe('user');
  });

  it('reads global Gemini MCPs into separate maps', async () => {
    const cwd = path.join(homeDir, 'workspace');
    await mkdir(path.join(homeDir, '.gemini'), { recursive: true });
    await writeFile(
      path.join(homeDir, '.gemini', 'settings.json'),
      JSON.stringify(
        {
          mcpServers: {
            github: {
              command: 'npx',
              args: ['-y', '@modelcontextprotocol/server-github'],
            },
            docs: {
              httpUrl: 'https://developers.openai.com/mcp',
              headers: {
                Authorization: 'Bearer token',
              },
            },
            events: {
              url: 'https://mcp.example.com/sse',
            },
          },
        },
        null,
        2
      ),
      'utf8'
    );

    const result = await createGeminiReader().read({ cwd });

    expect(result.mcpServers).toEqual({
      github: {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-github'],
      },
    });
    expect(result.remoteMcpServers).toEqual({
      docs: {
        transport: 'http',
        url: 'https://developers.openai.com/mcp',
        headers: {
          Authorization: 'Bearer token',
        },
      },
      events: {
        transport: 'sse',
        url: 'https://mcp.example.com/sse',
      },
    });
  });
});
