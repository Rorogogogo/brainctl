import { describe, expect, it } from 'vitest';

import { createMcpPreflightService } from '../../src/services/platform/mcp-preflight-service.js';

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

  it('passes for a remote HTTP MCP entry', async () => {
    const service = createMcpPreflightService({
      resolveExecutable: async () => '/usr/bin/unused',
      pathExists: async () => true,
    });

    const result = await service.execute({
      cwd: '/tmp/project',
      agent: 'claude',
      key: 'docs',
      remoteEntry: {
        transport: 'http',
        url: 'https://developers.openai.com/mcp',
      },
    });

    expect(result.ok).toBe(true);
    expect(result.checks).toContainEqual({
      label: 'Remote URL',
      status: 'ok',
      message: 'Remote MCP URL is valid: https://developers.openai.com/mcp',
    });
  });

  it('rejects remote MCP headers for Codex because the target config format cannot preserve them', async () => {
    const service = createMcpPreflightService({
      resolveExecutable: async () => '/usr/bin/unused',
      pathExists: async () => true,
    });

    const result = await service.execute({
      cwd: '/tmp/project',
      agent: 'codex',
      key: 'docs',
      remoteEntry: {
        transport: 'http',
        url: 'https://developers.openai.com/mcp',
        headers: {
          Authorization: 'Bearer token',
        },
      },
    });

    expect(result.ok).toBe(false);
    expect(result.checks).toContainEqual({
      label: 'Remote support',
      status: 'error',
      message: 'Codex remote MCP entries only support a plain HTTP url today; headers and env cannot be preserved exactly.',
    });
  });

  it('passes for uvx package runners', async () => {
    const service = createMcpPreflightService({
      resolveExecutable: async () => '/usr/bin/uvx',
      pathExists: async () => true,
    });

    const result = await service.execute({
      cwd: '/tmp/project',
      agent: 'codex',
      key: 'fetch',
      entry: {
        command: 'uvx',
        args: ['mcp-server-fetch'],
      },
    });

    expect(result.ok).toBe(true);
    expect(result.checks).toContainEqual({
      label: 'Launcher',
      status: 'ok',
      message: 'Launcher "uvx" is supported for exact MCP copy.',
    });
  });

  it('rejects unsupported local launchers such as docker', async () => {
    const service = createMcpPreflightService({
      resolveExecutable: async () => '/usr/bin/docker',
      pathExists: async () => true,
    });

    const result = await service.execute({
      cwd: '/tmp/project',
      agent: 'gemini',
      key: 'containerized',
      entry: {
        command: 'docker',
        args: ['run', 'my-image'],
      },
    });

    expect(result.ok).toBe(false);
    expect(result.checks).toContainEqual({
      label: 'Launcher',
      status: 'error',
      message: 'Launcher "docker" is not supported for exact MCP copy. Supported launchers: npx, uvx, node, python, python3, java -jar, go run, cargo run, and local binaries/scripts.',
    });
  });
});
