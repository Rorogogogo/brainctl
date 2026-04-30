import { ValidationError } from '../../errors.js';
import type { AgentName } from '../../types.js';
import type { AgentLiveConfig, AgentMcpEntry, AgentSkillEntry } from '../agent/agent-config-service.js';
import { createAgentConfigService } from '../agent/agent-config-service.js';
import { getAgentFilePath, getCommandFilePath, getSkillDir } from './skill-paths.js';
import {
  removeManagedPluginInstall,
  writeManagedPluginInstall,
} from '../sync/managed-plugin-registry.js';
import {
  defaultCopySkillDirectory,
  defaultInstallAgent,
  defaultInstallCommand,
  defaultRemoveAgentFile,
  defaultRemoveCommandFile,
  defaultRemoveSkillDirectory,
} from './plugin-install-fs.js';
import {
  detectIncompatibleArtifacts,
  formatCompatibilityWarnings,
  pathExists,
} from './plugin-install-compatibility.js';
import {
  defaultReadInstalledPluginBundle,
  isAgentInstallableOnTarget,
  isCommandInstallableOnTarget,
  type PluginBundle,
  type PluginBundleAgent,
  type PluginBundleCommand,
} from './plugin-install-bundle.js';
import {
  defaultUninstallClaudePlugin,
  defaultUninstallCodexPlugin,
  isUnmanagedClaudePlugin,
  isUnmanagedCodexPlugin,
} from './plugin-install-uninstall.js';
export type { PluginBundleAgent, PluginBundleCommand };

export interface PluginInstallCheck {
  label: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
}

export interface PluginInstallPlan {
  ok: boolean;
  checks: PluginInstallCheck[];
  skills: string[];
  mcps: Record<string, AgentMcpEntry>;
  agents: string[];
  commands: string[];
}

export interface PluginInstallResult {
  installedSkills: string[];
  installedMcps: string[];
  installedAgents: string[];
  installedCommands: string[];
}

export interface PluginUninstallPlan {
  ok: boolean;
  checks: PluginInstallCheck[];
  skills: string[];
  mcps: string[];
  agents: string[];
  commands: string[];
}

export interface PluginUninstallResult {
  removedSkills: string[];
  removedMcps: string[];
  removedAgents: string[];
  removedCommands: string[];
}

export interface PluginInstallService {
  plan(options: {
    cwd: string;
    targetAgent: AgentName;
    sourceAgent: AgentName;
    plugin: AgentSkillEntry;
  }): Promise<PluginInstallPlan>;
  execute(options: {
    cwd: string;
    targetAgent: AgentName;
    sourceAgent: AgentName;
    plugin: AgentSkillEntry;
  }): Promise<PluginInstallResult>;
  planRemoval(options: {
    cwd: string;
    targetAgent: AgentName;
    plugin: AgentSkillEntry;
  }): Promise<PluginUninstallPlan>;
  remove(options: {
    cwd: string;
    targetAgent: AgentName;
    plugin: AgentSkillEntry;
  }): Promise<PluginUninstallResult>;
}

interface PluginInstallDependencies {
  readInstalledPluginBundle?: (installPath: string) => Promise<PluginBundle>;
  readTargetState?: (options: { cwd: string; agent: AgentName }) => Promise<Pick<AgentLiveConfig, 'skills' | 'mcpServers'>>;
  copySkillDirectory?: (options: {
    sourceInstallPath: string;
    skillName: string;
    targetAgent: AgentName;
  }) => Promise<void>;
  installAgent?: (options: {
    targetAgent: AgentName;
    agent: PluginBundleAgent;
  }) => Promise<void>;
  installCommand?: (options: {
    targetAgent: AgentName;
    command: PluginBundleCommand;
  }) => Promise<void>;
  addMcpEntry?: (options: {
    cwd: string;
    agent: AgentName;
    key: string;
    entry: AgentMcpEntry;
  }) => Promise<void>;
  recordManagedPluginInstall?: (options: {
    agent: AgentName;
    plugin: AgentSkillEntry;
  }) => Promise<void>;
  removeSkillDirectory?: (options: {
    targetAgent: AgentName;
    skillName: string;
  }) => Promise<void>;
  removeAgentFile?: (options: {
    targetAgent: AgentName;
    agentName: string;
  }) => Promise<void>;
  removeCommandFile?: (options: {
    targetAgent: AgentName;
    commandName: string;
  }) => Promise<void>;
  removeMcpEntry?: (options: {
    cwd: string;
    agent: AgentName;
    key: string;
  }) => Promise<void>;
  removeManagedPluginInstall?: (options: {
    agent: AgentName;
    pluginName: string;
  }) => Promise<void>;
  uninstallCodexPlugin?: (options: {
    pluginKey: string;
    installPath: string;
  }) => Promise<void>;
  uninstallClaudePlugin?: (options: {
    pluginKey: string;
    installPath: string;
  }) => Promise<void>;
}

export function createPluginInstallService(
  dependencies: PluginInstallDependencies = {}
): PluginInstallService {
  const agentConfigService = createAgentConfigService();
  const readInstalledPluginBundle = dependencies.readInstalledPluginBundle ?? defaultReadInstalledPluginBundle;
  const readTargetState = dependencies.readTargetState ?? (async ({ cwd, agent }) => {
    const configs = await agentConfigService.readAll({ cwd });
    const match = configs.find((config) => config.agent === agent);
    return {
      skills: match?.skills ?? [],
      mcpServers: match?.mcpServers ?? {},
    };
  });
  const copySkillDirectory = dependencies.copySkillDirectory ?? defaultCopySkillDirectory;
  const installAgent = dependencies.installAgent ?? defaultInstallAgent;
  const installCommand = dependencies.installCommand ?? defaultInstallCommand;
  const addMcpEntry = dependencies.addMcpEntry ?? (async ({ cwd, agent, key, entry }) => {
    await agentConfigService.addMcp({ cwd, agent, key, entry });
  });
  const recordManagedPluginInstall =
    dependencies.recordManagedPluginInstall ??
    (async ({ agent, plugin }) => {
      await writeManagedPluginInstall({ agent, plugin });
    });
  const removeSkillDirectory = dependencies.removeSkillDirectory ?? defaultRemoveSkillDirectory;
  const removeAgentFile = dependencies.removeAgentFile ?? defaultRemoveAgentFile;
  const removeCommandFile = dependencies.removeCommandFile ?? defaultRemoveCommandFile;
  const removeMcpEntry = dependencies.removeMcpEntry ?? (async ({ cwd, agent, key }) => {
    await agentConfigService.removeMcp({ cwd, agent, key });
  });
  const uninstallCodexPlugin = dependencies.uninstallCodexPlugin ?? defaultUninstallCodexPlugin;
  const uninstallClaudePlugin = dependencies.uninstallClaudePlugin ?? defaultUninstallClaudePlugin;
  const removeRecordedManagedPluginInstall =
    dependencies.removeManagedPluginInstall ??
    (async ({ agent, pluginName }) => {
      await removeManagedPluginInstall({ agent, pluginName });
    });

  return {
    async plan(options) {
      const checks: PluginInstallCheck[] = [];

      if (options.plugin.kind !== 'plugin' || !options.plugin.installPath) {
        checks.push({
          label: 'Source plugin',
          status: 'error',
          message: `Plugin "${options.plugin.name}" is missing an install path and cannot be installed as a bundle.`,
        });
        return { ok: false, checks, skills: [], mcps: {}, agents: [], commands: [] };
      }

      const bundle = await readInstalledPluginBundle(options.plugin.installPath);
      const targetState = await readTargetState({
        cwd: options.cwd,
        agent: options.targetAgent,
      });

      const bundleAgents = bundle.agents ?? [];
      const bundleCommands = bundle.commands ?? [];
      const agentsForTarget = bundleAgents.filter(() =>
        isAgentInstallableOnTarget(options.targetAgent)
      );
      const commandsForTarget = bundleCommands.filter(() =>
        isCommandInstallableOnTarget(options.targetAgent)
      );

      checks.push({
        label: 'Bundle',
        status: 'ok',
        message: `Discovered ${bundle.skills.length} skills, ${Object.keys(bundle.mcps).length} MCPs, ${agentsForTarget.length} agents, and ${commandsForTarget.length} commands in plugin "${options.plugin.name}".`,
      });

      if (
        bundle.skills.length === 0 &&
        Object.keys(bundle.mcps).length === 0 &&
        agentsForTarget.length === 0 &&
        commandsForTarget.length === 0
      ) {
        checks.push({
          label: 'Bundle',
          status: 'error',
          message: `Plugin "${options.plugin.name}" does not expose portable skills or MCPs for installation.`,
        });
      }

      const incompatible = await detectIncompatibleArtifacts(options.plugin.installPath);
      for (const warning of formatCompatibilityWarnings(incompatible, {
        sourceAgent: options.sourceAgent,
        targetAgent: options.targetAgent,
      })) {
        checks.push(warning);
      }

      for (const skillName of bundle.skills) {
        if (targetState.skills.some((skill) => skill.name === skillName)) {
          checks.push({
            label: 'Target skill',
            status: 'error',
            message: `Skill "${skillName}" already exists in ${options.targetAgent}.`,
          });
        }
      }

      for (const key of Object.keys(bundle.mcps)) {
        if (targetState.mcpServers[key]) {
          checks.push({
            label: 'Target MCP',
            status: 'error',
            message: `MCP "${key}" already exists in ${options.targetAgent}.`,
          });
        }
      }

      for (const agent of agentsForTarget) {
        const targetPath = getAgentFilePath(options.targetAgent, agent.name);
        if (await pathExists(targetPath)) {
          checks.push({
            label: 'Target agent',
            status: 'error',
            message: `Agent "${agent.name}" already exists in ${options.targetAgent}.`,
          });
        }
      }

      for (const command of commandsForTarget) {
        if (options.targetAgent === 'claude') {
          const targetPath = getCommandFilePath('claude', command.name);
          if (await pathExists(targetPath)) {
            checks.push({
              label: 'Target command',
              status: 'error',
              message: `Command "${command.name}" already exists in claude.`,
            });
          }
        } else if (options.targetAgent === 'codex') {
          const skillDir = getSkillDir('codex', command.name);
          if (await pathExists(skillDir) || targetState.skills.some((s) => s.name === command.name)) {
            checks.push({
              label: 'Target command',
              status: 'error',
              message: `Command "${command.name}" already exists as a skill in codex.`,
            });
          }
        }
      }

      return {
        ok: checks.every((check) => check.status !== 'error'),
        checks,
        skills: bundle.skills,
        mcps: bundle.mcps,
        agents: agentsForTarget.map((a) => a.name),
        commands: commandsForTarget.map((c) => c.name),
      };
    },

    async execute(options) {
      const plan = await this.plan(options);
      if (!plan.ok) {
        const firstError = plan.checks.find((check) => check.status === 'error');
        throw new ValidationError(firstError?.message ?? 'Plugin install plan failed.');
      }

      const installPath = options.plugin.installPath!;
      const bundle = await readInstalledPluginBundle(installPath);

      for (const skillName of plan.skills) {
        await copySkillDirectory({
          sourceInstallPath: installPath,
          skillName,
          targetAgent: options.targetAgent,
        });
      }

      for (const [key, entry] of Object.entries(plan.mcps)) {
        await addMcpEntry({
          cwd: options.cwd,
          agent: options.targetAgent,
          key,
          entry,
        });
      }

      for (const agentName of plan.agents) {
        const agent = (bundle.agents ?? []).find((a) => a.name === agentName);
        if (!agent) continue;
        await installAgent({ targetAgent: options.targetAgent, agent });
      }

      for (const commandName of plan.commands) {
        const command = (bundle.commands ?? []).find((c) => c.name === commandName);
        if (!command) continue;
        await installCommand({ targetAgent: options.targetAgent, command });
      }

      await recordManagedPluginInstall({
        agent: options.targetAgent,
        plugin: {
          ...options.plugin,
          kind: 'plugin',
          pluginSkills: plan.skills,
          pluginMcps: Object.keys(plan.mcps),
          pluginAgents: plan.agents,
          pluginCommands: plan.commands,
          managed: true,
        },
      });

      return {
        installedSkills: plan.skills,
        installedMcps: Object.keys(plan.mcps),
        installedAgents: plan.agents,
        installedCommands: plan.commands,
      };
    },

    async planRemoval(options) {
      const checks: PluginInstallCheck[] = [];

      if (options.plugin.kind !== 'plugin') {
        checks.push({
          label: 'Target plugin',
          status: 'error',
          message: `"${options.plugin.name}" is not a plugin entry.`,
        });
        return { ok: false, checks, skills: [], mcps: [], agents: [], commands: [] };
      }

      const unmanagedCodex = isUnmanagedCodexPlugin(options.targetAgent, options.plugin);
      const unmanagedClaude = isUnmanagedClaudePlugin(options.targetAgent, options.plugin);

      if (!options.plugin.managed && !unmanagedCodex && !unmanagedClaude) {
        checks.push({
          label: 'Target plugin',
          status: 'error',
          message: `Only Brainctl-managed plugin installs can be removed today. "${options.plugin.name}" is not managed by Brainctl on ${options.targetAgent}.`,
        });
        return { ok: false, checks, skills: [], mcps: [], agents: [], commands: [] };
      }

      const skills = [...(options.plugin.pluginSkills ?? [])];
      const mcps = [...(options.plugin.pluginMcps ?? [])];
      const agents = [...(options.plugin.pluginAgents ?? [])];
      const commands = [...(options.plugin.pluginCommands ?? [])];

      checks.push({
        label: 'Bundle',
        status: 'ok',
        message:
          unmanagedCodex || unmanagedClaude
            ? `Will uninstall ${options.targetAgent} plugin "${options.plugin.name}" (${skills.length} skills, ${mcps.length} MCPs, ${agents.length} agents, ${commands.length} commands) and remove its cache directory.`
            : `Will remove ${skills.length} skills, ${mcps.length} MCPs, ${agents.length} agents, and ${commands.length} commands from plugin "${options.plugin.name}".`,
      });

      return {
        ok: true,
        checks,
        skills,
        mcps,
        agents,
        commands,
      };
    },

    async remove(options) {
      const plan = await this.planRemoval(options);
      if (!plan.ok) {
        const firstError = plan.checks.find((check) => check.status === 'error');
        throw new ValidationError(firstError?.message ?? 'Plugin removal plan failed.');
      }

      if (isUnmanagedCodexPlugin(options.targetAgent, options.plugin)) {
        const pluginKey = `${options.plugin.name}@${options.plugin.source}`;
        await uninstallCodexPlugin({
          pluginKey,
          installPath: options.plugin.installPath as string,
        });
        return {
          removedSkills: plan.skills,
          removedMcps: plan.mcps,
          removedAgents: plan.agents,
          removedCommands: plan.commands,
        };
      }

      if (isUnmanagedClaudePlugin(options.targetAgent, options.plugin)) {
        const pluginKey = `${options.plugin.name}@${options.plugin.source}`;
        await uninstallClaudePlugin({
          pluginKey,
          installPath: options.plugin.installPath as string,
        });
        return {
          removedSkills: plan.skills,
          removedMcps: plan.mcps,
          removedAgents: plan.agents,
          removedCommands: plan.commands,
        };
      }

      for (const skillName of plan.skills) {
        await removeSkillDirectory({
          targetAgent: options.targetAgent,
          skillName,
        });
      }

      for (const key of plan.mcps) {
        await removeMcpEntry({
          cwd: options.cwd,
          agent: options.targetAgent,
          key,
        });
      }

      for (const agentName of plan.agents) {
        await removeAgentFile({ targetAgent: options.targetAgent, agentName });
      }

      for (const commandName of plan.commands) {
        await removeCommandFile({ targetAgent: options.targetAgent, commandName });
      }

      await removeRecordedManagedPluginInstall({
        agent: options.targetAgent,
        pluginName: options.plugin.name,
      });

      return {
        removedSkills: plan.skills,
        removedMcps: plan.mcps,
        removedAgents: plan.agents,
        removedCommands: plan.commands,
      };
    },
  };
}

