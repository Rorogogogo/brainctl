import { describe, expect, it } from 'vitest';

import {
  applyPendingChangesWithApi,
  canStagePendingAddition,
  formatPluginSubtitle,
  splitAgentSkillEntries,
  type AgentLiveConfig,
  type PendingChange,
} from '../../web/src/profiles/profiles-view.js';
import {
  applyPendingChanges,
  buildChangeSummaryLines,
  buildOverlayData,
  finalizeResolvedPendingAddition,
  resolvePendingAdditionConflict,
} from '../../web/src/profiles/board/useProfilesBoard.js';
import {
  buildProfileApplyItemActions,
  findProfileApplyConflicts,
} from '../../web/src/profiles/profile-apply-conflicts.js';

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
        agent: 'antigravity',
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
      agent: 'antigravity',
      key: 'notes',
      skillEntry: { name: 'notes', source: 'local' },
      sourceAgent: 'claude',
    });

    expect(error).toBe('Skill "notes" already exists in Antigravity. Remove it first before copying.');
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
        agent: 'antigravity',
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

  it('resolves a same-name MCP drop by replacing the target item', () => {
    const configs: AgentLiveConfig[] = [
      {
        agent: 'claude',
        configPath: '/tmp/claude.json',
        exists: true,
        mcpServers: {
          github: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] },
        },
        remoteMcpServers: {},
        projectMcpServers: {},
        projectRemoteMcpServers: {},
        skills: [],
      },
      {
        agent: 'codex',
        configPath: '/tmp/config.toml',
        exists: true,
        mcpServers: {
          github: { command: 'node', args: ['old.js'] },
        },
        remoteMcpServers: {},
        projectMcpServers: {},
        projectRemoteMcpServers: {},
        skills: [],
      },
    ];

    const result = resolvePendingAdditionConflict({
      agentConfigs: configs,
      pendingChanges: [],
      nextChange: {
        id: 'change-add',
        type: 'add',
        category: 'mcp',
        agent: 'codex',
        key: 'github',
        scope: 'global',
        entry: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] },
        sourceAgent: 'claude',
      },
      resolution: 'replace',
      suggestedKey: 'github-copy',
      createChangeId: () => 'change-remove',
    });

    expect(result.error).toBeNull();
    expect(result.changes).toEqual([
      {
        id: 'change-remove',
        type: 'remove',
        category: 'mcp',
        agent: 'codex',
        key: 'github',
        scope: 'global',
      },
      {
        id: 'change-add',
        type: 'add',
        category: 'mcp',
        agent: 'codex',
        key: 'github',
        scope: 'global',
        entry: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] },
        sourceAgent: 'claude',
      },
    ]);
  });

  it('resolves a same-name skill drop by keeping both with a new target name', () => {
    const configs: AgentLiveConfig[] = [
      {
        agent: 'claude',
        configPath: '/tmp/claude.json',
        exists: true,
        mcpServers: {},
        remoteMcpServers: {},
        projectMcpServers: {},
        projectRemoteMcpServers: {},
        skills: [{ name: 'notes', source: 'local', kind: 'skill' }],
      },
      {
        agent: 'codex',
        configPath: '/tmp/config.toml',
        exists: true,
        mcpServers: {},
        remoteMcpServers: {},
        projectMcpServers: {},
        projectRemoteMcpServers: {},
        skills: [
          { name: 'notes', source: 'local', kind: 'skill' },
          { name: 'notes-copy', source: 'local', kind: 'skill' },
        ],
      },
    ];

    const result = resolvePendingAdditionConflict({
      agentConfigs: configs,
      pendingChanges: [],
      nextChange: {
        id: 'change-add',
        type: 'add',
        category: 'skill',
        agent: 'codex',
        key: 'notes',
        scope: 'global',
        skillEntry: { name: 'notes', source: 'local', kind: 'skill' },
        sourceAgent: 'claude',
      },
      resolution: 'keep-both',
      suggestedKey: 'notes-copy-2',
      createChangeId: () => 'unused',
    });

    expect(result.error).toBeNull();
    expect(result.changes).toEqual([
      {
        id: 'change-add',
        type: 'add',
        category: 'skill',
        agent: 'codex',
        key: 'notes-copy-2',
        sourceKey: 'notes',
        scope: 'global',
        skillEntry: { name: 'notes-copy-2', source: 'local', kind: 'skill' },
        sourceAgent: 'claude',
      },
    ]);
  });

  it('builds per-agent profile apply conflict actions', () => {
    const configs: AgentLiveConfig[] = [
      {
        agent: 'claude',
        configPath: '/tmp/claude.json',
        exists: true,
        mcpServers: {},
        remoteMcpServers: {},
        projectMcpServers: {
          docs: { command: 'node', args: ['old.js'] },
          'docs-copy': { command: 'node', args: ['other.js'] },
        },
        projectRemoteMcpServers: {},
        skills: [{ name: 'notes', source: 'local', kind: 'skill', scope: 'user' }],
      },
      {
        agent: 'codex',
        configPath: '/tmp/config.toml',
        exists: true,
        mcpServers: {},
        remoteMcpServers: {},
        projectMcpServers: {},
        projectRemoteMcpServers: {},
        skills: [{ name: 'demo', source: 'market', kind: 'plugin', scope: 'user' }],
      },
    ];

    const conflicts = findProfileApplyConflicts({
      configs,
      agents: ['claude', 'codex'],
      items: [
        { type: 'mcp', name: 'docs' },
        { type: 'skill', name: 'notes' },
        { type: 'plugin', name: 'demo' },
      ],
      excludedKeys: new Set(),
    });

    expect(conflicts.map((conflict) => ({
      id: conflict.id,
      suggestedName: conflict.suggestedName,
      canKeepBoth: conflict.canKeepBoth,
    }))).toEqual([
      { id: 'claude:mcp:docs', suggestedName: 'docs-copy-2', canKeepBoth: true },
      { id: 'claude:skill:notes', suggestedName: 'notes-copy', canKeepBoth: true },
      { id: 'codex:plugin:demo', suggestedName: 'demo-copy', canKeepBoth: false },
    ]);

    expect(
      buildProfileApplyItemActions(conflicts, {
        'claude:mcp:docs': 'keep-both',
        'claude:skill:notes': 'drop',
        'codex:plugin:demo': 'replace',
      })
    ).toEqual([
      {
        agent: 'claude',
        type: 'mcp',
        name: 'docs',
        action: 'keep-both',
        targetName: 'docs-copy-2',
      },
      { agent: 'claude', type: 'skill', name: 'notes', action: 'drop' },
    ]);
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
        agent: 'antigravity',
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
      agent: 'antigravity',
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
        agent: 'antigravity',
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
      '- [Skill] notes from Antigravity',
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
        projectMcpServers: {},
        projectRemoteMcpServers: {},
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
        projectMcpServers: {},
        projectRemoteMcpServers: {},
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
