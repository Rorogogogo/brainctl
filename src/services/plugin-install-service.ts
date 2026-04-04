import { cp, mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';

import { ValidationError } from '../errors.js';
import type { AgentName } from '../types.js';
import type { AgentLiveConfig, AgentMcpEntry, AgentSkillEntry } from './agent-config-service.js';
import { createAgentConfigService } from './agent-config-service.js';
import { getSkillDir } from './skill-paths.js';
import {
  removeManagedPluginInstall,
  writeManagedPluginInstall,
} from './sync/managed-plugin-registry.js';

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
}

export interface PluginInstallResult {
  installedSkills: string[];
  installedMcps: string[];
}

export interface PluginUninstallPlan {
  ok: boolean;
  checks: PluginInstallCheck[];
  skills: string[];
  mcps: string[];
}

export interface PluginUninstallResult {
  removedSkills: string[];
  removedMcps: string[];
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

interface PluginBundle {
  skills: string[];
  mcps: Record<string, AgentMcpEntry>;
}

interface PluginInstallDependencies {
  readInstalledPluginBundle?: (installPath: string) => Promise<PluginBundle>;
  readTargetState?: (options: { cwd: string; agent: AgentName }) => Promise<Pick<AgentLiveConfig, 'skills' | 'mcpServers'>>;
  copySkillDirectory?: (options: {
    sourceInstallPath: string;
    skillName: string;
    targetAgent: AgentName;
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
  removeMcpEntry?: (options: {
    cwd: string;
    agent: AgentName;
    key: string;
  }) => Promise<void>;
  removeManagedPluginInstall?: (options: {
    agent: AgentName;
    pluginName: string;
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
  const addMcpEntry = dependencies.addMcpEntry ?? (async ({ cwd, agent, key, entry }) => {
    await agentConfigService.addMcp({ cwd, agent, key, entry });
  });
  const recordManagedPluginInstall =
    dependencies.recordManagedPluginInstall ??
    (async ({ agent, plugin }) => {
      await writeManagedPluginInstall({ agent, plugin });
    });
  const removeSkillDirectory = dependencies.removeSkillDirectory ?? defaultRemoveSkillDirectory;
  const removeMcpEntry = dependencies.removeMcpEntry ?? (async ({ cwd, agent, key }) => {
    await agentConfigService.removeMcp({ cwd, agent, key });
  });
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
        return { ok: false, checks, skills: [], mcps: {} };
      }

      const bundle = await readInstalledPluginBundle(options.plugin.installPath);
      const targetState = await readTargetState({
        cwd: options.cwd,
        agent: options.targetAgent,
      });

      checks.push({
        label: 'Bundle',
        status: 'ok',
        message: `Discovered ${bundle.skills.length} skills and ${Object.keys(bundle.mcps).length} MCPs in plugin "${options.plugin.name}".`,
      });

      if (bundle.skills.length === 0 && Object.keys(bundle.mcps).length === 0) {
        checks.push({
          label: 'Bundle',
          status: 'error',
          message: `Plugin "${options.plugin.name}" does not expose portable skills or MCPs for installation.`,
        });
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

      return {
        ok: checks.every((check) => check.status !== 'error'),
        checks,
        skills: bundle.skills,
        mcps: bundle.mcps,
      };
    },

    async execute(options) {
      const plan = await this.plan(options);
      if (!plan.ok) {
        const firstError = plan.checks.find((check) => check.status === 'error');
        throw new ValidationError(firstError?.message ?? 'Plugin install plan failed.');
      }

      const installPath = options.plugin.installPath!;
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

      await recordManagedPluginInstall({
        agent: options.targetAgent,
        plugin: {
          ...options.plugin,
          kind: 'plugin',
          pluginSkills: plan.skills,
          pluginMcps: Object.keys(plan.mcps),
          managed: true,
        },
      });

      return {
        installedSkills: plan.skills,
        installedMcps: Object.keys(plan.mcps),
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
        return { ok: false, checks, skills: [], mcps: [] };
      }

      if (!options.plugin.managed) {
        checks.push({
          label: 'Target plugin',
          status: 'error',
          message: `Only Brainctl-managed plugin installs can be removed today. "${options.plugin.name}" is not managed by Brainctl on ${options.targetAgent}.`,
        });
        return { ok: false, checks, skills: [], mcps: [] };
      }

      let skills = [...(options.plugin.pluginSkills ?? [])];
      let mcps = [...(options.plugin.pluginMcps ?? [])];

      if ((skills.length === 0 || mcps.length === 0) && options.plugin.installPath) {
        const bundle = await readInstalledPluginBundle(options.plugin.installPath);
        if (skills.length === 0) {
          skills = bundle.skills;
        }
        if (mcps.length === 0) {
          mcps = Object.keys(bundle.mcps);
        }
      }

      checks.push({
        label: 'Bundle',
        status: 'ok',
        message: `Will remove ${skills.length} skills and ${mcps.length} MCPs from plugin "${options.plugin.name}".`,
      });

      return {
        ok: true,
        checks,
        skills,
        mcps,
      };
    },

    async remove(options) {
      const plan = await this.planRemoval(options);
      if (!plan.ok) {
        const firstError = plan.checks.find((check) => check.status === 'error');
        throw new ValidationError(firstError?.message ?? 'Plugin removal plan failed.');
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

      await removeRecordedManagedPluginInstall({
        agent: options.targetAgent,
        pluginName: options.plugin.name,
      });

      return {
        removedSkills: plan.skills,
        removedMcps: plan.mcps,
      };
    },
  };
}

async function defaultReadInstalledPluginBundle(installPath: string): Promise<PluginBundle> {
  const skillsDir = path.join(installPath, 'skills');
  let skills: string[] = [];
  try {
    const { readdir } = await import('node:fs/promises');
    const entries = await readdir(skillsDir, { withFileTypes: true });
    skills = entries
      .filter((entry) => !entry.name.startsWith('.') && entry.isDirectory())
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));
  } catch {
    skills = [];
  }

  let mcps: Record<string, AgentMcpEntry> = {};
  try {
    const mcpSource = await readFile(path.join(installPath, '.mcp.json'), 'utf8');
    const parsed = JSON.parse(mcpSource) as Record<string, { command?: unknown; args?: unknown; env?: unknown }>;
    mcps = Object.fromEntries(
      Object.entries(parsed)
        .filter(([, value]) => typeof value?.command === 'string')
        .map(([key, value]) => [
          key,
          {
            command: String(value.command),
            args: Array.isArray(value.args) ? value.args.map(String) : undefined,
            env:
              value.env && typeof value.env === 'object' && !Array.isArray(value.env)
                ? Object.fromEntries(
                    Object.entries(value.env as Record<string, unknown>).map(([envKey, envValue]) => [
                      envKey,
                      String(envValue),
                    ])
                  )
                : undefined,
          } satisfies AgentMcpEntry,
        ])
    );
  } catch {
    mcps = {};
  }

  return { skills, mcps };
}

async function defaultCopySkillDirectory(options: {
  sourceInstallPath: string;
  skillName: string;
  targetAgent: AgentName;
}): Promise<void> {
  const sourceDir = path.join(options.sourceInstallPath, 'skills', options.skillName);
  const targetDir = getSkillDir(options.targetAgent, options.skillName);
  await mkdir(path.dirname(targetDir), { recursive: true });
  await cp(sourceDir, targetDir, { recursive: true });
}

async function defaultRemoveSkillDirectory(options: {
  targetAgent: AgentName;
  skillName: string;
}): Promise<void> {
  const targetDir = getSkillDir(options.targetAgent, options.skillName);
  await rm(targetDir, { recursive: true, force: true });
}
