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
      runtime: 'node',
      path: path.join(cwd, 'dist'),
      command: 'node',
      args: ['./dist/index.js'],
    });
  });

  it('classifies python script-runner entries as bundled with runtime', () => {
    const cwd = path.join(path.sep, 'workspace', 'project');

    const result = classifyPortableMcp({
      cwd,
      key: 'python-tool',
      entry: {
        command: 'python',
        args: ['./src/server.py'],
      },
    });

    expect(result).toEqual({
      kind: 'local',
      source: 'bundled',
      runtime: 'python',
      path: path.join(cwd, 'src'),
      command: 'python',
      args: ['./src/server.py'],
    });
  });

  it('classifies java -jar entries as bundled with runtime', () => {
    const cwd = path.join(path.sep, 'workspace', 'project');

    const result = classifyPortableMcp({
      cwd,
      key: 'java-tool',
      entry: {
        command: 'java',
        args: ['-jar', './dist/server.jar'],
      },
    });

    expect(result).toEqual({
      kind: 'local',
      source: 'bundled',
      runtime: 'java',
      path: path.join(cwd, 'dist'),
      command: 'java',
      args: ['-jar', './dist/server.jar'],
    });
  });

  it('classifies go run entries as bundled with runtime', () => {
    const cwd = path.join(path.sep, 'workspace', 'project');

    const result = classifyPortableMcp({
      cwd,
      key: 'go-tool',
      entry: {
        command: 'go',
        args: ['run', './cmd/server'],
      },
    });

    expect(result).toEqual({
      kind: 'local',
      source: 'bundled',
      runtime: 'go',
      path: path.join(cwd, 'cmd'),
      command: 'go',
      args: ['run', './cmd/server'],
    });
  });

  it('classifies cargo run entries as bundled with runtime', () => {
    const cwd = path.join(path.sep, 'workspace', 'project');

    const result = classifyPortableMcp({
      cwd,
      key: 'rust-tool',
      entry: {
        command: 'cargo',
        args: ['run'],
      },
    });

    expect(result).toEqual({
      kind: 'local',
      source: 'bundled',
      runtime: 'rust',
      path: cwd,
      command: 'cargo',
      args: ['run'],
    });
  });

  it('classifies relative path commands as bundled binary', () => {
    const cwd = path.join(path.sep, 'workspace', 'project');
    const result = classifyPortableMcp({
      cwd,
      key: 'local-path-tool',
      entry: { command: './dist/server' },
    });
    expect(result).toEqual({
      kind: 'local',
      source: 'bundled',
      runtime: 'binary',
      path: path.join(cwd, 'dist'),
      command: './dist/server',
    });
  });

  it('classifies uvx as npm-like package runner', () => {
    const result = classifyPortableMcp({
      cwd: '/workspace/project',
      key: 'fetch-tool',
      entry: {
        command: 'uvx',
        args: ['mcp-server-fetch'],
      },
    });

    expect(result).toEqual({
      kind: 'local',
      source: 'npm',
      package: 'mcp-server-fetch',
    });
  });

  it('adds runtime field to existing node bundled classification', () => {
    const cwd = path.join(path.sep, 'workspace', 'project');

    const result = classifyPortableMcp({
      cwd,
      key: 'node-tool',
      entry: {
        command: 'node',
        args: ['./dist/index.js'],
      },
    });

    expect(result).toMatchObject({
      source: 'bundled',
      runtime: 'node',
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
          command: 'docker',
          args: ['run', 'my-image'],
        },
      })
    ).toThrowError(
      'MCP "unknown-tool" cannot be packed: unrecognized command "docker".'
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
    ).toThrowError('cannot be packed: path "/usr/local/bin" is outside the project directory');
  });

  it('classifies relative path commands as bundled binary', () => {
    const cwd = path.join(path.sep, 'workspace', 'project');
    const result = classifyPortableMcp({
      cwd,
      key: 'local-path-tool',
      entry: { command: './dist/index.js' },
    });
    expect(result).toEqual({
      kind: 'local',
      source: 'bundled',
      runtime: 'binary',
      path: path.join(cwd, 'dist'),
      command: './dist/index.js',
    });
  });

  it.each([
    ['tool.py'],
    ['tool.sh'],
    ['data.json'],
  ])('classifies bare local filename %s for node script runners as bundled at cwd', (filename) => {
    const cwd = '/workspace/project';
    const result = classifyPortableMcp({
      cwd,
      key: filename,
      entry: {
        command: 'node',
        args: [filename],
      },
    });
    expect(result).toEqual({
      kind: 'local',
      source: 'bundled',
      runtime: 'node',
      path: cwd,
      command: 'node',
      args: [filename],
    });
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
