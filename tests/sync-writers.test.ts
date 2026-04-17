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

import { createClaudeWriter } from '../src/services/sync/claude-writer.js';
import { createCodexWriter } from '../src/services/sync/codex-writer.js';
import { createGeminiWriter } from '../src/services/sync/gemini-writer.js';

describe('sync writers', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'brainctl-sync-writers-'));
    mockHomedir.mockReturnValue(tempDir);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('writes Claude project MCPs without adding brainctl automatically', async () => {
    const configPath = path.join(tempDir, '.claude.json');
    await writeFile(
      configPath,
      JSON.stringify(
        {
          projects: {
            '/tmp/other-project': {
              mcpServers: {
                existing: {
                  type: 'stdio',
                  command: 'npx',
                  args: ['-y', 'existing-server'],
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

    const writer = createClaudeWriter();
    await writer.write({
      cwd: '/tmp/project',
      mcpServers: {},
    });

    const saved = JSON.parse(await readFile(configPath, 'utf8')) as {
      projects: Record<string, { mcpServers?: Record<string, unknown> }>;
    };

    expect(saved.projects['/tmp/project']?.mcpServers).toEqual({});
    expect(saved.projects['/tmp/other-project']?.mcpServers).toEqual({
      existing: {
        type: 'stdio',
        command: 'npx',
        args: ['-y', 'existing-server'],
      },
    });
  });

  it('writes Codex MCP config without adding brainctl automatically', async () => {
    const configDir = path.join(tempDir, '.codex');
    const configPath = path.join(configDir, 'config.toml');
    await mkdir(configDir, { recursive: true });
    await writeFile(configPath, 'model = "gpt-5.4"\n', 'utf8');

    const writer = createCodexWriter();
    await writer.write({
      cwd: '/tmp/project',
      mcpServers: {},
    });

    const saved = await readFile(configPath, 'utf8');

    expect(saved).toContain('model = "gpt-5.4"');
    expect(saved).not.toContain('[mcp_servers.brainctl]');
  });

  it('writes Gemini MCP config without adding brainctl automatically', async () => {
    const cwd = path.join(tempDir, 'project');
    const configDir = path.join(cwd, '.gemini');
    const configPath = path.join(configDir, 'settings.json');
    await mkdir(configDir, { recursive: true });
    await writeFile(
      configPath,
      JSON.stringify(
        {
          theme: 'dark',
        },
        null,
        2
      ),
      'utf8'
    );

    const writer = createGeminiWriter();
    await writer.write({
      cwd,
      mcpServers: {},
    });

    const saved = JSON.parse(await readFile(configPath, 'utf8')) as {
      theme?: string;
      mcpServers?: Record<string, unknown>;
    };

    expect(saved.theme).toBe('dark');
    expect(saved.mcpServers).toEqual({});
  });
});
