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
} from '../src/services/sync/agent-reader.js';

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

  it('reads project-local Gemini MCPs into separate maps', async () => {
    const cwd = path.join(homeDir, 'workspace');
    await mkdir(path.join(cwd, '.gemini'), { recursive: true });
    await writeFile(
      path.join(cwd, '.gemini', 'settings.json'),
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
