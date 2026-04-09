import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  classifyPortableMcp,
  PortableMcpClassificationError,
} from '../src/services/portable-mcp-classifier.js';

describe('classifyPortableMcp', () => {
  it('classifies npx-based entries as local npm MCPs', () => {
    const result = classifyPortableMcp({
      cwd: '/workspace/project',
      key: 'github',
      entry: {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-github'],
        env: {
          GITHUB_TOKEN: '${credentials.github_token}',
        },
      },
    });

    expect(result).toEqual({
      kind: 'local',
      source: 'npm',
      package: '@modelcontextprotocol/server-github',
      env: {
        GITHUB_TOKEN: '${credentials.github_token}',
      },
    });
  });

  it('uses the declared package when npx passes --package', () => {
    const result = classifyPortableMcp({
      cwd: '/workspace/project',
      key: 'github',
      entry: {
        command: 'npx',
        args: ['--package=@modelcontextprotocol/server-github', 'server-bin'],
      },
    });

    expect(result).toEqual({
      kind: 'local',
      source: 'npm',
      package: '@modelcontextprotocol/server-github',
    });
  });

  it('uses the declared package when npx passes --package as a separate argument', () => {
    const result = classifyPortableMcp({
      cwd: '/workspace/project',
      key: 'github',
      entry: {
        command: 'npx',
        args: ['--package', '@modelcontextprotocol/server-github', 'server-bin'],
      },
    });

    expect(result).toEqual({
      kind: 'local',
      source: 'npm',
      package: '@modelcontextprotocol/server-github',
    });
  });

  it('classifies script-runner entries with a local entrypoint as bundled MCPs', () => {
    const cwd = path.join(path.sep, 'workspace', 'project');

    const result = classifyPortableMcp({
      cwd,
      key: 'custom-tool',
      entry: {
        command: 'node',
        args: ['./dist/index.js'],
      },
    });

    expect(result).toEqual({
      kind: 'local',
      source: 'bundled',
      path: path.join(cwd, 'dist'),
      command: 'node',
      args: ['./dist/index.js'],
    });
  });

  it('classifies explicit remote metadata as remote MCPs', () => {
    const result = classifyPortableMcp({
      cwd: '/workspace/project',
      key: 'docs',
      entry: {
        command: 'npx',
        args: ['-y', 'ignored'],
      },
      remote: {
        transport: 'http',
        url: 'https://mcp.example.com',
        headers: {
          Authorization: 'Bearer token',
        },
      },
    });

    expect(result).toEqual({
      kind: 'remote',
      transport: 'http',
      url: 'https://mcp.example.com',
      headers: {
        Authorization: 'Bearer token',
      },
    });
  });

  it('rejects remote metadata with an invalid url', () => {
    expect(() =>
      classifyPortableMcp({
        cwd: '/workspace/project',
        key: 'docs',
        entry: {
          command: 'npx',
          args: ['-y', 'ignored'],
        },
        remote: {
          transport: 'http',
          url: 'not-a-url',
        },
      })
    ).toThrowError('Remote MCP "docs" must include an absolute http(s) url.');
  });

  it('rejects remote metadata with an invalid transport', () => {
    expect(() =>
      classifyPortableMcp({
        cwd: '/workspace/project',
        key: 'docs',
        entry: {
          command: 'npx',
          args: ['-y', 'ignored'],
        },
        remote: {
          transport: 'httpx' as 'http',
          url: 'https://mcp.example.com',
        },
      })
    ).toThrowError('Remote MCP "docs" must use transport "http" or "sse".');
  });

  it('rejects ambiguous live entries that cannot be safely packed', () => {
    expect(() =>
      classifyPortableMcp({
        cwd: '/workspace/project',
        key: 'unknown-tool',
        entry: {
          command: 'uvx',
          args: ['my-server'],
        },
      })
    ).toThrowError(
      'MCP "unknown-tool" cannot be packed from the live agent config because it is neither an explicit remote MCP nor a local npx/bundled entry.'
    );
  });

  it('rejects absolute command-path launchers instead of treating them as bundled', () => {
    expect(() =>
      classifyPortableMcp({
        cwd: '/workspace/project',
        key: 'system-tool',
        entry: {
          command: '/usr/local/bin/tool',
        },
      })
    ).toThrowError(PortableMcpClassificationError);
  });

  it('rejects path-based command launchers instead of treating them as bundled', () => {
    expect(() =>
      classifyPortableMcp({
        cwd: '/workspace/project',
        key: 'local-path-tool',
        entry: {
          command: './dist/index.js',
        },
      })
    ).toThrowError(
      'MCP "local-path-tool" cannot be packed from the live agent config because it is neither an explicit remote MCP nor a local npx/bundled entry.'
    );
  });

  it.each([
    ['tool.py'],
    ['tool.sh'],
    ['data.json'],
  ])('rejects bare local filename %s for script runners', (filename) => {
    expect(() =>
      classifyPortableMcp({
        cwd: '/workspace/project',
        key: filename,
        entry: {
          command: 'node',
          args: [filename],
        },
      })
    ).toThrowError(
      `MCP "${filename}" cannot be packed from the live agent config because it is neither an explicit remote MCP nor a local npx/bundled entry.`
    );
  });

  it('rejects npx entries that do not declare a package', () => {
    expect(() =>
      classifyPortableMcp({
        cwd: '/workspace/project',
        key: 'broken',
        entry: {
          command: 'npx',
          args: ['-y'],
        },
      })
    ).toThrowError(PortableMcpClassificationError);
  });

  it('exposes the remoteMcpServers live-config contract shape', () => {
    const liveConfig: import('../src/services/sync/agent-reader.js').AgentLiveConfig = {
      agent: 'claude',
      configPath: '/tmp/.claude.json',
      exists: true,
      mcpServers: {},
      remoteMcpServers: {},
      skills: [],
    };

    expect(liveConfig.remoteMcpServers).toEqual({});
  });
});
