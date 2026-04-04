import { describe, expect, it } from 'vitest';

import { createMcpPreflightService } from '../src/services/mcp-preflight-service.js';

describe('mcp preflight service', () => {
  it('fails when the MCP command is not available on PATH', async () => {
    const service = createMcpPreflightService({
      resolveExecutable: async () => null,
      pathExists: async () => true,
    });

    const result = await service.execute({
      cwd: '/tmp/project',
      agent: 'codex',
      key: 'github',
      entry: {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-github'],
      },
    });

    expect(result.ok).toBe(false);
    expect(result.checks).toContainEqual({
      label: 'Command',
      status: 'error',
      message: 'Command "npx" is not available on PATH.',
    });
  });

  it('fails when a script-based MCP entry references a missing local file', async () => {
    const service = createMcpPreflightService({
      resolveExecutable: async () => '/usr/bin/node',
      pathExists: async () => false,
    });

    const result = await service.execute({
      cwd: '/tmp/project',
      agent: 'claude',
      key: 'local-server',
      entry: {
        command: 'node',
        args: ['./scripts/server.js'],
      },
    });

    expect(result.ok).toBe(false);
    expect(result.checks).toContainEqual({
      label: 'Entrypoint',
      status: 'error',
      message: 'Entrypoint script was not found: /tmp/project/scripts/server.js',
    });
  });

  it('passes for a local MCP entry with an available command and entrypoint', async () => {
    const service = createMcpPreflightService({
      resolveExecutable: async () => '/usr/bin/node',
      pathExists: async () => true,
    });

    const result = await service.execute({
      cwd: '/tmp/project',
      agent: 'gemini',
      key: 'local-server',
      entry: {
        command: 'node',
        args: ['./scripts/server.js'],
      },
    });

    expect(result.ok).toBe(true);
    expect(result.checks).toContainEqual({
      label: 'Command',
      status: 'ok',
      message: 'Command "node" resolved to /usr/bin/node.',
    });
  });
});
