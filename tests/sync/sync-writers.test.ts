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

import { createClaudeWriter } from '../../src/services/sync/claude-writer.js';
import { createCodexWriter, stripPluginSection } from '../../src/services/sync/codex-writer.js';
import { createAntigravityWriter } from '../../src/services/sync/antigravity-writer.js';

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

  it('writes Antigravity MCP config without adding brainctl automatically', async () => {
    const cwd = path.join(tempDir, 'project');
    const configDir = path.join(tempDir, '.gemini', 'antigravity-cli');
    const configPath = path.join(configDir, 'mcp_config.json');
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

    const writer = createAntigravityWriter();
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

describe('stripPluginSection', () => {
  it('removes the matching plugin section and leaves other sections intact', () => {
    const input = [
      'model = "gpt-5"',
      '',
      '[plugins."gmail@openai-curated"]',
      'enabled = true',
      '',
      '[plugins."github@openai-curated"]',
      'enabled = true',
      '',
      '[mcp_servers.playwright]',
      'command = "npx"',
    ].join('\n');

    const output = stripPluginSection(input, 'gmail@openai-curated');

    expect(output).not.toContain('gmail@openai-curated');
    expect(output).toContain('[plugins."github@openai-curated"]');
    expect(output).toContain('[mcp_servers.playwright]');
    expect(output).toContain('model = "gpt-5"');
  });

  it('handles the target being the final section in the file', () => {
    const input = [
      '[features]',
      'unified_exec = true',
      '',
      '[plugins."gmail@openai-curated"]',
      'enabled = true',
    ].join('\n');

    const output = stripPluginSection(input, 'gmail@openai-curated');

    expect(output).not.toContain('gmail@openai-curated');
    expect(output).toContain('[features]');
    expect(output).toContain('unified_exec = true');
  });

  it('returns content unchanged when the plugin key is not present', () => {
    const input = '[plugins."github@openai-curated"]\nenabled = true\n';
    expect(stripPluginSection(input, 'gmail@openai-curated')).toBe(input);
  });
});
