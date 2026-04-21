import { describe, expect, it } from 'vitest';

import {
  applyPendingChangesWithApi,
  canStagePendingAddition,
  formatPluginSubtitle,
  splitAgentSkillEntries,
  type AgentLiveConfig,
  type PendingChange,
} from '../web/src/profiles-view.js';
import {
  applyPendingChanges,
  buildChangeSummaryLines,
  buildOverlayData,
  finalizeResolvedPendingAddition,
} from '../web/src/profiles-board/useProfilesBoard.js';

describe('profiles view helpers', () => {
  it('rejects staging an MCP onto a target agent that already has the same key', () => {
    const configs: AgentLiveConfig[] = [
      {
        agent: 'claude',
        configPath: '/tmp/claude.json',
        exists: true,
        mcpServers: {
          github: {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-github'],
          },
        },
        remoteMcpServers: {},
        skills: [],
      },
      {
        agent: 'codex',
        configPath: '/tmp/config.toml',
        exists: true,
        mcpServers: {
          github: {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-github'],
          },
        },
        remoteMcpServers: {},
        skills: [],
      },
    ];

    const error = canStagePendingAddition(configs, {
      id: 'change-1',
      type: 'add',
      category: 'mcp',
      agent: 'codex',
      key: 'github',
      entry: {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-github'],
      },
      sourceAgent: 'claude',
    });

    expect(error).toBe('MCP "github" already exists in Codex. Remove it first before copying.');
  });

  it('rejects staging a skill onto a target agent that already has the same name', () => {
    const configs: AgentLiveConfig[] = [
      {
        agent: 'claude',
        configPath: '/tmp/claude.json',
        exists: true,
        mcpServers: {},
        remoteMcpServers: {},
        skills: [{ name: 'notes', source: 'local' }],
      },
      {
        agent: 'gemini',
        configPath: '/tmp/gemini.json',
        exists: true,
        mcpServers: {},
        remoteMcpServers: {},
        skills: [{ name: 'notes', source: 'local' }],
      },
    ];

    const error = canStagePendingAddition(configs, {
      id: 'change-1',
      type: 'add',
      category: 'skill',
      agent: 'gemini',
      key: 'notes',
      skillEntry: { name: 'notes', source: 'local' },
      sourceAgent: 'claude',
    });

    expect(error).toBe('Skill "notes" already exists in Gemini. Remove it first before copying.');
  });

  it('keeps failed changes staged after attempting to apply them', async () => {
    const changes: PendingChange[] = [
      {
        id: 'change-1',
        type: 'add',
        category: 'mcp',
        agent: 'codex',
        key: 'github',
        entry: {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-github'],
        },
      },
      {
        id: 'change-2',
        type: 'remove',
        category: 'skill',
        agent: 'gemini',
        key: 'notes',
      },
    ];

    const seen: string[] = [];

    const result = await applyPendingChangesWithApi(changes, async (change) => {
      seen.push(change.id);
      if (change.id === 'change-2') {
        throw new Error('permission denied');
      }
    });

    expect(seen).toEqual(['change-1', 'change-2']);
    expect(result.applied).toEqual([changes[0]]);
    expect(result.failed).toEqual([
      {
        change: changes[1],
        error: 'permission denied',
      },
    ]);
  });

  it('separates local skills from plugin-backed entries for display', () => {
    const result = splitAgentSkillEntries([
      { name: 'notes', source: 'local', kind: 'skill' },
      { name: 'github', source: 'claude-plugins-official', kind: 'plugin' },
      { name: 'dispatching-parallel-agents', source: 'linked', kind: 'skill' },
    ]);

    expect(result.skills).toEqual([
      { name: 'notes', source: 'local', kind: 'skill' },
      { name: 'dispatching-parallel-agents', source: 'linked', kind: 'skill' },
    ]);
    expect(result.plugins).toEqual([
      { name: 'github', source: 'claude-plugins-official', kind: 'plugin' },
    ]);
  });

  it('formats plugin skill subtitles from the plugin-owned skill list', () => {
    expect(
      formatPluginSubtitle({
        name: 'superpowers',
        source: 'claude-plugins-official',
        kind: 'plugin',
        pluginSkills: ['systematic-debugging', 'test-driven-development'],
      })
    ).toBe('claude-plugins-official • 2 skills');

    expect(
      formatPluginSubtitle({
        name: 'context7',
        source: 'claude-plugins-official',
        kind: 'plugin',
        pluginSkills: [],
      })
    ).toBe('claude-plugins-official');
  });

  it('rejects staging a plugin onto a target agent that already has the same plugin', () => {
    const configs: AgentLiveConfig[] = [
      {
        agent: 'claude',
        configPath: '/tmp/claude.json',
        exists: true,
        mcpServers: {},
        remoteMcpServers: {},
        skills: [{ name: 'frontend-design', source: 'claude-plugins-official', kind: 'plugin' }],
      },
      {
        agent: 'codex',
        configPath: '/tmp/config.toml',
        exists: true,
        mcpServers: {},
        remoteMcpServers: {},
        skills: [{ name: 'frontend-design', source: 'claude-plugins-official', kind: 'plugin', managed: true }],
      },
    ];

    const error = canStagePendingAddition(configs, {
      id: 'change-1',
      type: 'add',
      category: 'plugin',
      agent: 'codex',
      key: 'frontend-design',
      pluginEntry: { name: 'frontend-design', source: 'claude-plugins-official', kind: 'plugin' },
      sourceAgent: 'claude',
    });

    expect(error).toBe('Plugin "frontend-design" already exists in Codex. Remove it first before copying.');
  });

  it('allows staging a remote MCP without local command metadata', () => {
    const configs: AgentLiveConfig[] = [
      {
        agent: 'claude',
        configPath: '/tmp/claude.json',
        exists: true,
        mcpServers: {},
        remoteMcpServers: {
          docs: {
            transport: 'http',
            url: 'https://developers.openai.com/mcp',
          },
        },
        skills: [],
      },
      {
        agent: 'gemini',
        configPath: '/tmp/gemini.json',
        exists: true,
        mcpServers: {},
        remoteMcpServers: {},
        skills: [],
      },
    ];

    const error = canStagePendingAddition(configs, {
      id: 'change-1',
      type: 'add',
      category: 'mcp',
      agent: 'gemini',
      key: 'docs',
      remoteEntry: {
        transport: 'http',
        url: 'https://developers.openai.com/mcp',
      },
      sourceAgent: 'claude',
    });

    expect(error).toBeNull();
  });

  it('formats staged change summaries with category-specific labels', () => {
    const changes: PendingChange[] = [
      {
        id: 'change-1',
        type: 'add',
        category: 'plugin',
        agent: 'codex',
        key: 'frontend-design',
      },
      {
        id: 'change-2',
        type: 'remove',
        category: 'skill',
        agent: 'gemini',
        key: 'notes',
      },
      {
        id: 'change-3',
        type: 'add',
        category: 'mcp',
        agent: 'claude',
        key: 'github',
      },
    ];

    expect(buildChangeSummaryLines(changes)).toEqual([
      '+ [Plugin] frontend-design → Codex',
      '- [Skill] notes from Gemini',
      '+ [MCP] github → Claude',
    ]);
  });

  it('builds overlay data from the active draggable item', () => {
    const configs: AgentLiveConfig[] = [
      {
        agent: 'claude',
        configPath: '/tmp/claude.json',
        exists: true,
        mcpServers: {},
        remoteMcpServers: {
          docs: {
            transport: 'http',
            url: 'https://developers.openai.com/mcp',
          },
        },
        skills: [
          {
            name: 'superpowers',
            source: 'claude-plugins-official',
            kind: 'plugin',
            pluginSkills: ['systematic-debugging', 'test-driven-development'],
          },
        ],
      },
    ];

    expect(buildOverlayData(configs, 'claude:mcp:docs')).toEqual({
      label: 'docs',
      sublabel: '[remote] HTTP https://developers.openai.com/mcp',
    });
    expect(buildOverlayData(configs, 'claude:plugin:superpowers')).toEqual({
      label: 'superpowers',
      sublabel: 'claude-plugins-official • 2 skills',
    });
  });

  it('applies successful staged changes to the live config snapshot', () => {
    const configs: AgentLiveConfig[] = [
      {
        agent: 'claude',
        configPath: '/tmp/claude.json',
        exists: true,
        mcpServers: {
          github: {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-github'],
          },
        },
        remoteMcpServers: {},
        skills: [{ name: 'notes', source: 'local', kind: 'skill' }],
      },
      {
        agent: 'codex',
        configPath: '/tmp/config.toml',
        exists: true,
        mcpServers: {},
        remoteMcpServers: {},
        skills: [],
      },
    ];
    const appliedChanges: PendingChange[] = [
      {
        id: 'change-1',
        type: 'add',
        category: 'mcp',
        agent: 'codex',
        key: 'github',
        entry: {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-github'],
        },
      },
      {
        id: 'change-2',
        type: 'remove',
        category: 'skill',
        agent: 'claude',
        key: 'notes',
      },
    ];

    expect(applyPendingChanges(configs, appliedChanges)).toEqual([
      {
        agent: 'claude',
        configPath: '/tmp/claude.json',
        exists: true,
        mcpServers: {
          github: {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-github'],
          },
        },
        remoteMcpServers: {},
        skills: [],
      },
      {
        agent: 'codex',
        configPath: '/tmp/config.toml',
        exists: true,
        mcpServers: {
          github: {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-github'],
          },
        },
        remoteMcpServers: {},
        skills: [],
      },
    ]);
  });

  it('ignores resolved preflights after the board state has been invalidated', () => {
    const configs: AgentLiveConfig[] = [
      {
        agent: 'claude',
        configPath: '/tmp/claude.json',
        exists: true,
        mcpServers: {
          github: {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-github'],
          },
        },
        remoteMcpServers: {},
        skills: [],
      },
      {
        agent: 'codex',
        configPath: '/tmp/config.toml',
        exists: true,
        mcpServers: {},
        remoteMcpServers: {},
        skills: [],
      },
    ];

    const nextChange: PendingChange = {
      id: 'change-1',
      type: 'add',
      category: 'mcp',
      agent: 'codex',
      key: 'github',
      entry: {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-github'],
      },
      sourceAgent: 'claude',
    };

    expect(
      finalizeResolvedPendingAddition({
        startedPreflightGeneration: 1,
        currentPreflightGeneration: 2,
        isEditMode: true,
        agentConfigs: configs,
        pendingChanges: [],
        nextChange,
      })
    ).toEqual({
      changes: [],
      didStage: false,
      error: null,
      reason: 'stale',
    });
  });

  it('deduplicates resolved preflight additions against the latest pending state', () => {
    const configs: AgentLiveConfig[] = [
      {
        agent: 'claude',
        configPath: '/tmp/claude.json',
        exists: true,
        mcpServers: {
          github: {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-github'],
          },
        },
        remoteMcpServers: {},
        skills: [],
      },
      {
        agent: 'codex',
        configPath: '/tmp/config.toml',
        exists: true,
        mcpServers: {},
        remoteMcpServers: {},
        skills: [],
      },
    ];

    const nextChange: PendingChange = {
      id: 'change-1',
      type: 'add',
      category: 'mcp',
      agent: 'codex',
      key: 'github',
      entry: {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-github'],
      },
      sourceAgent: 'claude',
    };

    expect(
      finalizeResolvedPendingAddition({
        startedPreflightGeneration: 3,
        currentPreflightGeneration: 3,
        isEditMode: true,
        agentConfigs: configs,
        pendingChanges: [nextChange],
        nextChange,
      })
    ).toEqual({
      changes: [nextChange],
      didStage: false,
      error: null,
      reason: 'duplicate',
    });
  });

  it('revalidates resolved preflights against the latest board state before staging', () => {
    const configs: AgentLiveConfig[] = [
      {
        agent: 'claude',
        configPath: '/tmp/claude.json',
        exists: true,
        mcpServers: {
          github: {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-github'],
          },
        },
        remoteMcpServers: {},
        skills: [],
      },
      {
        agent: 'codex',
        configPath: '/tmp/config.toml',
        exists: true,
        mcpServers: {
          github: {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-github'],
          },
        },
        remoteMcpServers: {},
        skills: [],
      },
    ];

    const nextChange: PendingChange = {
      id: 'change-1',
      type: 'add',
      category: 'mcp',
      agent: 'codex',
      key: 'github',
      entry: {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-github'],
      },
      sourceAgent: 'claude',
    };

    expect(
      finalizeResolvedPendingAddition({
        startedPreflightGeneration: 4,
        currentPreflightGeneration: 4,
        isEditMode: true,
        agentConfigs: configs,
        pendingChanges: [],
        nextChange,
      })
    ).toEqual({
      changes: [],
      didStage: false,
      error: 'MCP "github" already exists in Codex. Remove it first before copying.',
      reason: 'conflict',
    });
  });
});
