import { describe, expect, it } from 'vitest';

import { ValidationError } from '../../src/errors.js';
import { createPluginInstallService } from '../../src/services/plugin/plugin-install-service.js';
import type { AgentLiveConfig, AgentMcpEntry, AgentSkillEntry } from '../../src/services/agent/agent-config-service.js';

describe('plugin install service', () => {
  it('plans bundled skills and MCPs from a source plugin install', async () => {
    const service = createPluginInstallService({
      readInstalledPluginBundle: async () => ({
        skills: ['test-driven-development', 'systematic-debugging'],
        mcps: {
          context7: {
            command: 'npx',
            args: ['-y', '@upstash/context7-mcp'],
          },
        },
      }),
      readTargetState: async () => ({
        skills: [],
        mcpServers: {},
      }),
      copySkillDirectory: async () => {},
      addMcpEntry: async () => {},
      recordManagedPluginInstall: async () => {},
    });

    const sourcePlugin: AgentSkillEntry = {
      name: 'superpowers',
      source: 'claude-plugins-official',
      kind: 'plugin',
      installPath: '/tmp/superpowers',
      pluginSkills: ['test-driven-development', 'systematic-debugging'],
    };

    const plan = await service.plan({
      cwd: '/tmp/project',
      targetAgent: 'codex',
      sourceAgent: 'claude',
      plugin: sourcePlugin,
    });

    expect(plan.ok).toBe(true);
    expect(plan.skills).toEqual(['test-driven-development', 'systematic-debugging']);
    expect(Object.keys(plan.mcps)).toEqual(['context7']);
  });

  it('rejects plugin installs when target skills or MCPs would conflict', async () => {
    const service = createPluginInstallService({
      readInstalledPluginBundle: async () => ({
        skills: ['notes'],
        mcps: {
          context7: {
            command: 'npx',
            args: ['-y', '@upstash/context7-mcp'],
          },
        },
      }),
      readTargetState: async () => ({
        skills: [{ name: 'notes', source: 'local', kind: 'skill' }],
        mcpServers: {
          context7: {
            command: 'npx',
            args: ['-y', '@upstash/context7-mcp'],
          },
        },
      }),
      copySkillDirectory: async () => {},
      addMcpEntry: async () => {},
      recordManagedPluginInstall: async () => {},
    });

    const sourcePlugin: AgentSkillEntry = {
      name: 'superpowers',
      source: 'claude-plugins-official',
      kind: 'plugin',
      installPath: '/tmp/superpowers',
    };

    const plan = await service.plan({
      cwd: '/tmp/project',
      targetAgent: 'codex',
      sourceAgent: 'claude',
      plugin: sourcePlugin,
    });

    expect(plan.ok).toBe(false);
    expect(plan.checks).toContainEqual({
      label: 'Target skill',
      status: 'error',
      message: 'Skill "notes" already exists in codex.',
    });
    expect(plan.checks).toContainEqual({
      label: 'Target MCP',
      status: 'error',
      message: 'MCP "context7" already exists in codex.',
    });
  });

  it('installs bundled skills and MCPs when the plan is valid', async () => {
    const copied: string[] = [];
    const addedMcps: string[] = [];
    const recordedPlugins: string[] = [];

    const service = createPluginInstallService({
      readInstalledPluginBundle: async () => ({
        skills: ['test-driven-development', 'systematic-debugging'],
        mcps: {
          context7: {
            command: 'npx',
            args: ['-y', '@upstash/context7-mcp'],
          },
        },
      }),
      readTargetState: async () => ({
        skills: [],
        mcpServers: {},
      }),
      copySkillDirectory: async ({ skillName }) => {
        copied.push(skillName);
      },
      addMcpEntry: async ({ key }) => {
        addedMcps.push(key);
      },
      recordManagedPluginInstall: async ({ plugin }) => {
        recordedPlugins.push(plugin.name);
      },
    });

    const sourcePlugin: AgentSkillEntry = {
      name: 'superpowers',
      source: 'claude-plugins-official',
      kind: 'plugin',
      installPath: '/tmp/superpowers',
    };

    const result = await service.execute({
      cwd: '/tmp/project',
      targetAgent: 'codex',
      sourceAgent: 'claude',
      plugin: sourcePlugin,
    });

    expect(result.installedSkills).toEqual(['test-driven-development', 'systematic-debugging']);
    expect(result.installedMcps).toEqual(['context7']);
    expect(copied).toEqual(['test-driven-development', 'systematic-debugging']);
    expect(addedMcps).toEqual(['context7']);
    expect(recordedPlugins).toEqual(['superpowers']);
  });

  it('removes all bundled assets for a managed plugin uninstall', async () => {
    const removedSkills: string[] = [];
    const removedMcps: string[] = [];
    const removedPlugins: string[] = [];

    const service = createPluginInstallService({
      readInstalledPluginBundle: async () => ({
        skills: ['frontend-design'],
        mcps: {
          context7: {
            command: 'npx',
            args: ['-y', '@upstash/context7-mcp'],
          },
        },
      }),
      readTargetState: async () => ({
        skills: [],
        mcpServers: {},
      }),
      copySkillDirectory: async () => {},
      addMcpEntry: async () => {},
      recordManagedPluginInstall: async () => {},
      removeSkillDirectory: async ({ skillName }) => {
        removedSkills.push(skillName);
      },
      removeMcpEntry: async ({ key }) => {
        removedMcps.push(key);
      },
      removeManagedPluginInstall: async ({ pluginName }) => {
        removedPlugins.push(pluginName);
      },
    });

    const installedPlugin: AgentSkillEntry = {
      name: 'frontend-design',
      source: 'claude-plugins-official',
      kind: 'plugin',
      managed: true,
      installPath: '/tmp/frontend-design',
      pluginSkills: ['frontend-design'],
      pluginMcps: ['context7'],
    };

    const result = await service.remove({
      cwd: '/tmp/project',
      targetAgent: 'codex',
      plugin: installedPlugin,
    });

    expect(result.removedSkills).toEqual(['frontend-design']);
    expect(result.removedMcps).toEqual(['context7']);
    expect(removedSkills).toEqual(['frontend-design']);
    expect(removedMcps).toEqual(['context7']);
    expect(removedPlugins).toEqual(['frontend-design']);
  });

  it('rejects uninstalling plugins that are not managed by Brainctl and lack an installPath', async () => {
    const service = createPluginInstallService({
      readInstalledPluginBundle: async () => ({
        skills: ['frontend-design'],
        mcps: {},
      }),
      readTargetState: async () => ({
        skills: [],
        mcpServers: {},
      }),
      copySkillDirectory: async () => {},
      addMcpEntry: async () => {},
      recordManagedPluginInstall: async () => {},
    });

    await expect(
      service.remove({
        cwd: '/tmp/project',
        targetAgent: 'claude',
        plugin: {
          name: 'frontend-design',
          source: 'claude-plugins-official',
          kind: 'plugin',
          pluginSkills: ['frontend-design'],
        },
      })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('removes an unmanaged Codex plugin by stripping its section and deleting its cache dir', async () => {
    const uninstallCalls: Array<{ pluginKey: string; installPath: string }> = [];
    const service = createPluginInstallService({
      readInstalledPluginBundle: async () => ({ skills: [], mcps: {} }),
      readTargetState: async () => ({ skills: [], mcpServers: {} }),
      copySkillDirectory: async () => {},
      addMcpEntry: async () => {},
      recordManagedPluginInstall: async () => {},
      uninstallCodexPlugin: async ({ pluginKey, installPath }) => {
        uninstallCalls.push({ pluginKey, installPath });
      },
    });

    const result = await service.remove({
      cwd: '/tmp/project',
      targetAgent: 'codex',
      plugin: {
        name: 'gmail',
        source: 'openai-curated',
        kind: 'plugin',
        installPath: '/tmp/cache/openai-curated/gmail/1.0.0',
        pluginSkills: ['gmail-search'],
        pluginMcps: ['gmail'],
      },
    });

    expect(uninstallCalls).toEqual([
      { pluginKey: 'gmail@openai-curated', installPath: '/tmp/cache/openai-curated/gmail/1.0.0' },
    ]);
    expect(result.removedSkills).toEqual(['gmail-search']);
    expect(result.removedMcps).toEqual(['gmail']);
  });

  it('removes an unmanaged Claude plugin by delegating to the claude CLI uninstall', async () => {
    const uninstallCalls: Array<{ pluginKey: string; installPath: string }> = [];
    const service = createPluginInstallService({
      readInstalledPluginBundle: async () => ({ skills: [], mcps: {} }),
      readTargetState: async () => ({ skills: [], mcpServers: {} }),
      copySkillDirectory: async () => {},
      addMcpEntry: async () => {},
      recordManagedPluginInstall: async () => {},
      uninstallClaudePlugin: async ({ pluginKey, installPath }) => {
        uninstallCalls.push({ pluginKey, installPath });
      },
    });

    const result = await service.remove({
      cwd: '/tmp/project',
      targetAgent: 'claude',
      plugin: {
        name: 'frontend-design',
        source: 'claude-plugins-official',
        kind: 'plugin',
        installPath: '/tmp/cache/claude-plugins-official/frontend-design/1.0.0',
        pluginSkills: ['frontend-design'],
      },
    });

    expect(uninstallCalls).toEqual([
      {
        pluginKey: 'frontend-design@claude-plugins-official',
        installPath: '/tmp/cache/claude-plugins-official/frontend-design/1.0.0',
      },
    ]);
    expect(result.removedSkills).toEqual(['frontend-design']);
  });

  it('still rejects unmanaged Codex plugins that lack an installPath', async () => {
    const service = createPluginInstallService({
      readInstalledPluginBundle: async () => ({ skills: [], mcps: {} }),
      readTargetState: async () => ({ skills: [], mcpServers: {} }),
      copySkillDirectory: async () => {},
      addMcpEntry: async () => {},
      recordManagedPluginInstall: async () => {},
    });

    await expect(
      service.remove({
        cwd: '/tmp/project',
        targetAgent: 'codex',
        plugin: {
          name: 'gmail',
          source: 'openai-curated',
          kind: 'plugin',
        },
      })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws a validation error when installing an invalid plugin plan', async () => {
    const service = createPluginInstallService({
      readInstalledPluginBundle: async () => ({
        skills: [],
        mcps: {},
      }),
      readTargetState: async () => ({
        skills: [],
        mcpServers: {},
      }),
      copySkillDirectory: async () => {},
      addMcpEntry: async () => {},
      recordManagedPluginInstall: async () => {},
    });

    const sourcePlugin: AgentSkillEntry = {
      name: 'context7',
      source: 'claude-plugins-official',
      kind: 'plugin',
    };

    await expect(
      service.execute({
        cwd: '/tmp/project',
        targetAgent: 'gemini',
        sourceAgent: 'claude',
        plugin: sourcePlugin,
      })
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
