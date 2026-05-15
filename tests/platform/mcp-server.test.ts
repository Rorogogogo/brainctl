import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, it, expect, vi } from 'vitest';
import { FastMCP } from 'fastmcp';
import { createMcpServer } from '../../src/mcp-server.js';

vi.mock('../src/config.js', () => ({
  loadConfig: vi.fn().mockResolvedValue({
    configPath: '/test/ai-stack.yaml',
    rootDir: '/test',
    memory: { paths: ['/test/memory'] },
    skills: {
      review: { prompt: 'Review the code', description: 'Code review skill' },
      summarize: { prompt: 'Summarize the input' },
    },
    mcps: {},
  }),
}));

vi.mock('../src/services/platform/status-service.js', () => ({
  createStatusService: vi.fn().mockReturnValue({
    execute: vi.fn().mockResolvedValue({
      configPath: '/test/ai-stack.yaml',
      memory: { content: '', files: [], count: 0, entries: [] },
      skills: ['review', 'summarize'],
      mcpCount: 0,
      agents: {
        claude: { agent: 'claude', available: true },
        codex: { agent: 'codex', available: false },
      },
    }),
  }),
}));

vi.mock('../src/services/platform/doctor-service.js', () => ({
  createDoctorService: vi.fn().mockReturnValue({
    execute: vi.fn().mockResolvedValue({
      checks: [
        { label: 'Config', status: 'ok', message: 'Loaded /test/ai-stack.yaml' },
      ],
      hasIssues: false,
    }),
  }),
}));

vi.mock('../src/services/run-service.js', () => ({
  createRunService: vi.fn().mockReturnValue({
    execute: vi.fn().mockResolvedValue({
      steps: [{
        stepIndex: 0,
        requestedAgent: 'claude',
        agent: 'claude',
        fallbackUsed: false,
        exitCode: 0,
        output: 'Skill output here',
      }],
      finalOutput: 'Skill output here',
      finalExitCode: 0,
    }),
  }),
}));

let tempDir: string | undefined;
let originalConfigPath: string | undefined;

afterEach(async () => {
  vi.restoreAllMocks();
  if (originalConfigPath === undefined) {
    delete process.env.BRAINCTL_CONFIG_PATH;
  } else {
    process.env.BRAINCTL_CONFIG_PATH = originalConfigPath;
  }
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe('MCP server', () => {
  it('creates a server with expected tools', () => {
    const server = createMcpServer({ cwd: '/test' });
    expect(server).toBeDefined();
  });

  it('registers registry publishing tools', () => {
    const toolNames: string[] = [];
    const originalAddTool = FastMCP.prototype.addTool;
    const addToolSpy = vi
      .spyOn(FastMCP.prototype, 'addTool')
      .mockImplementation(function (this: FastMCP, tool) {
        toolNames.push(tool.name);
        return originalAddTool.call(this, tool);
      });

    createMcpServer({ cwd: '/test' });

    expect(toolNames).toContain('brainctl_register_github_profile');
    expect(toolNames).toContain('brainctl_publish_profile');
    expect(toolNames).toContain('brainctl_install_registry_profile');
    expect(toolNames).toContain('brainctl_config_status');

    addToolSpy.mockRestore();
  });

  it('uses the shared apiBaseUrl config for registry tools', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'brainctl-mcp-config-'));
    originalConfigPath = process.env.BRAINCTL_CONFIG_PATH;
    process.env.BRAINCTL_CONFIG_PATH = path.join(tempDir, 'config.json');
    await mkdir(tempDir, { recursive: true });
    await writeFile(
      process.env.BRAINCTL_CONFIG_PATH,
      JSON.stringify({ apiBaseUrl: 'https://api.brainctl.test' }),
      'utf8'
    );

    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url) => {
        calls.push(String(url));
        return new Response(
          JSON.stringify({
            slug: 'review-profile',
            version: '1.0.0',
            source_kind: 'github',
            download_url: 'https://github.com/acme/review-profile/archive/refs/heads/main.tar.gz',
            checksum_sha256: null,
          }),
          { status: 200 }
        );
      })
    );
    let registryTool:
      | {
          execute: (args: { slug: string }) => Promise<string>;
        }
      | undefined;
    const originalAddTool = FastMCP.prototype.addTool;
    const addToolSpy = vi
      .spyOn(FastMCP.prototype, 'addTool')
      .mockImplementation(function (this: FastMCP, tool) {
        if (tool.name === 'brainctl_install_registry_profile') {
          registryTool = tool as typeof registryTool;
        }
        return originalAddTool.call(this, tool);
      });

    createMcpServer({ cwd: '/test' });
    await registryTool?.execute({ slug: 'review-profile' });

    expect(calls[0]).toBe('https://api.brainctl.test/profiles/review-profile/install');
    addToolSpy.mockRestore();
  });

  it('exposes the active api target through MCP', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'brainctl-mcp-status-'));
    originalConfigPath = process.env.BRAINCTL_CONFIG_PATH;
    process.env.BRAINCTL_CONFIG_PATH = path.join(tempDir, 'config.json');
    await writeFile(
      process.env.BRAINCTL_CONFIG_PATH,
      JSON.stringify({ apiBaseUrl: 'http://127.0.0.1:3877' }),
      'utf8'
    );

    let statusTool:
      | {
          execute: () => Promise<string>;
        }
      | undefined;
    const originalAddTool = FastMCP.prototype.addTool;
    const addToolSpy = vi
      .spyOn(FastMCP.prototype, 'addTool')
      .mockImplementation(function (this: FastMCP, tool) {
        if (tool.name === 'brainctl_config_status') {
          statusTool = tool as typeof statusTool;
        }
        return originalAddTool.call(this, tool);
      });

    createMcpServer({ cwd: '/test' });
    const result = JSON.parse((await statusTool?.execute()) ?? '{}') as {
      apiBaseUrl: string;
      source: string;
      mode: string;
    };

    expect(result).toEqual({
      apiBaseUrl: 'http://127.0.0.1:3877',
      source: 'config',
      mode: 'local',
    });
    addToolSpy.mockRestore();
  });
});
