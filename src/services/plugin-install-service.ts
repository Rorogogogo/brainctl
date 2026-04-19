import { spawn } from 'node:child_process';
import { copyFile, cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

import { ValidationError } from '../errors.js';
import { formatTimestamp } from './sync/agent-writer.js';
import { stripPluginSection } from './sync/codex-writer.js';
import type { AgentName } from '../types.js';
import type { AgentLiveConfig, AgentMcpEntry, AgentSkillEntry } from './agent-config-service.js';
import { createAgentConfigService } from './agent-config-service.js';
import {
  claudeAgentMdToCodexToml,
  claudeCommandMdToCodexSkill,
  codexAgentTomlToClaudeMd,
} from './agent-converter-service.js';
import { getAgentFilePath, getCommandFilePath, getSkillDir } from './skill-paths.js';
import {
  removeManagedPluginInstall,
  writeManagedPluginInstall,
} from './sync/managed-plugin-registry.js';

export interface PluginInstallCheck {
  label: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
}

export interface PluginBundleAgent {
  name: string;
  sourceFormat: 'claude-md' | 'codex-toml';
  content: string;
}

export interface PluginBundleCommand {
  name: string;
  content: string;
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

interface PluginBundle {
  skills: string[];
  mcps: Record<string, AgentMcpEntry>;
  agents: PluginBundleAgent[];
  commands: PluginBundleCommand[];
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

function isUnmanagedCodexPlugin(targetAgent: AgentName, plugin: AgentSkillEntry): boolean {
  return (
    !plugin.managed &&
    targetAgent === 'codex' &&
    typeof plugin.installPath === 'string' &&
    typeof plugin.source === 'string' &&
    plugin.source.length > 0
  );
}

function isUnmanagedClaudePlugin(targetAgent: AgentName, plugin: AgentSkillEntry): boolean {
  return (
    !plugin.managed &&
    targetAgent === 'claude' &&
    typeof plugin.installPath === 'string' &&
    typeof plugin.source === 'string' &&
    plugin.source.length > 0
  );
}

async function defaultUninstallClaudePlugin(options: {
  pluginKey: string;
  installPath: string;
}): Promise<void> {
  // Delegate to `claude plugin uninstall` so a running Claude Code session
  // drops the plugin from its in-memory state (direct fs mutation gets
  // resurrected by live sessions that still have the plugin loaded).
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      'claude',
      ['plugin', 'uninstall', options.pluginKey, '--scope', 'user'],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );

    let stderr = '';
    let stdout = '';
    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      reject(
        new ValidationError(
          `Failed to invoke \`claude\` CLI: ${error.message}. Is Claude Code installed on PATH?`
        )
      );
    });
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      const detail = (stderr || stdout).trim();
      reject(
        new ValidationError(
          `\`claude plugin uninstall ${options.pluginKey}\` exited ${code}${detail ? `: ${detail}` : ''}`
        )
      );
    });
  });
}

async function defaultUninstallCodexPlugin(options: {
  pluginKey: string;
  installPath: string;
}): Promise<void> {
  const home = homedir();
  const cacheRoot = path.join(home, '.codex', 'plugins', 'cache');
  const resolvedInstall = path.resolve(options.installPath);

  if (!resolvedInstall.startsWith(cacheRoot + path.sep)) {
    throw new ValidationError(
      `Refusing to remove Codex plugin files outside ${cacheRoot}: ${resolvedInstall}`
    );
  }

  const pluginRoot = path.dirname(resolvedInstall);
  const configPath = path.join(home, '.codex', 'config.toml');

  let existing = '';
  try {
    existing = await readFile(configPath, 'utf8');
  } catch {
    existing = '';
  }

  if (existing.length > 0) {
    const next = stripPluginSection(existing, options.pluginKey);
    if (next !== existing) {
      const backupPath = `${configPath}.bak.${formatTimestamp()}`;
      await copyFile(configPath, backupPath);
      const tmpPath = `${configPath}.tmp.${Date.now()}`;
      await writeFile(tmpPath, next, 'utf8');
      await rename(tmpPath, configPath);
    }
  }

  await rm(pluginRoot, { recursive: true, force: true });
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

  const agents: PluginBundleAgent[] = [];
  try {
    const entries = await readdir(path.join(installPath, 'agents'), { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (entry.name.endsWith('.md')) {
        const content = await readFile(path.join(installPath, 'agents', entry.name), 'utf8');
        agents.push({ name: entry.name.replace(/\.md$/, ''), sourceFormat: 'claude-md', content });
      } else if (entry.name.endsWith('.toml')) {
        const content = await readFile(path.join(installPath, 'agents', entry.name), 'utf8');
        agents.push({ name: entry.name.replace(/\.toml$/, ''), sourceFormat: 'codex-toml', content });
      }
    }
    agents.sort((left, right) => left.name.localeCompare(right.name));
  } catch {
    // no agents dir
  }

  const commands: PluginBundleCommand[] = [];
  try {
    const entries = await readdir(path.join(installPath, 'commands'), { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      const content = await readFile(path.join(installPath, 'commands', entry.name), 'utf8');
      commands.push({ name: entry.name.replace(/\.md$/, ''), content });
    }
    commands.sort((left, right) => left.name.localeCompare(right.name));
  } catch {
    // no commands dir
  }

  return { skills, mcps, agents, commands };
}

function isAgentInstallableOnTarget(target: AgentName): boolean {
  return target === 'claude' || target === 'codex';
}

function isCommandInstallableOnTarget(target: AgentName): boolean {
  return target === 'claude' || target === 'codex';
}

async function defaultInstallAgent(options: {
  targetAgent: AgentName;
  agent: PluginBundleAgent;
}): Promise<void> {
  const targetPath = getAgentFilePath(options.targetAgent, options.agent.name);
  await mkdir(path.dirname(targetPath), { recursive: true });

  let output: string;
  if (options.targetAgent === 'claude') {
    output = options.agent.sourceFormat === 'claude-md'
      ? options.agent.content
      : codexAgentTomlToClaudeMd(options.agent.content);
  } else if (options.targetAgent === 'codex') {
    output = options.agent.sourceFormat === 'codex-toml'
      ? options.agent.content
      : claudeAgentMdToCodexToml(options.agent.content);
  } else {
    throw new Error(`Agent install is not supported for ${options.targetAgent}`);
  }

  await writeFile(targetPath, output, 'utf8');
}

async function defaultInstallCommand(options: {
  targetAgent: AgentName;
  command: PluginBundleCommand;
}): Promise<void> {
  if (options.targetAgent === 'claude') {
    const targetPath = getCommandFilePath('claude', options.command.name);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, options.command.content, 'utf8');
    return;
  }
  if (options.targetAgent === 'codex') {
    const skillDir = getSkillDir('codex', options.command.name);
    await mkdir(skillDir, { recursive: true });
    const { skillMarkdown } = claudeCommandMdToCodexSkill(options.command.content);
    await writeFile(path.join(skillDir, 'SKILL.md'), skillMarkdown, 'utf8');
    return;
  }
  throw new Error(`Command install is not supported for ${options.targetAgent}`);
}

async function defaultRemoveAgentFile(options: {
  targetAgent: AgentName;
  agentName: string;
}): Promise<void> {
  const targetPath = getAgentFilePath(options.targetAgent, options.agentName);
  await rm(targetPath, { force: true });
}

async function defaultRemoveCommandFile(options: {
  targetAgent: AgentName;
  commandName: string;
}): Promise<void> {
  if (options.targetAgent === 'claude') {
    const targetPath = getCommandFilePath('claude', options.commandName);
    await rm(targetPath, { force: true });
    return;
  }
  if (options.targetAgent === 'codex') {
    const skillDir = getSkillDir('codex', options.commandName);
    await rm(skillDir, { recursive: true, force: true });
    return;
  }
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

interface IncompatibleArtifacts {
  hasAppConnector: boolean;
  hasHooks: boolean;
  hasCommands: boolean;
  codexAgentSkills: string[];
  claudeAgents: string[];
}

async function detectIncompatibleArtifacts(installPath: string): Promise<IncompatibleArtifacts> {
  const [hasAppConnector, hasHooks, hasCommands, codexAgentSkills, claudeAgents] = await Promise.all([
    pathExists(path.join(installPath, '.app.json')),
    pathExists(path.join(installPath, 'hooks')),
    pathExists(path.join(installPath, 'commands')),
    listCodexAgentSkills(installPath),
    listClaudeAgentFiles(installPath),
  ]);

  return { hasAppConnector, hasHooks, hasCommands, codexAgentSkills, claudeAgents };
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

async function listCodexAgentSkills(installPath: string): Promise<string[]> {
  const skillsDir = path.join(installPath, 'skills');
  try {
    const entries = await readdir(skillsDir, { withFileTypes: true });
    const matches: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      if (await pathExists(path.join(skillsDir, entry.name, 'agents'))) {
        matches.push(entry.name);
      }
    }
    return matches.sort((left, right) => left.localeCompare(right));
  } catch {
    return [];
  }
}

async function listClaudeAgentFiles(installPath: string): Promise<string[]> {
  const agentsDir = path.join(installPath, 'agents');
  try {
    const entries = await readdir(agentsDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry) => entry.name.replace(/\.md$/, ''))
      .sort((left, right) => left.localeCompare(right));
  } catch {
    return [];
  }
}

function formatCompatibilityWarnings(
  artifacts: IncompatibleArtifacts,
  context: { sourceAgent: AgentName; targetAgent: AgentName }
): PluginInstallCheck[] {
  const warnings: PluginInstallCheck[] = [];

  if (artifacts.hasAppConnector && context.targetAgent !== 'codex') {
    warnings.push({
      label: 'App connector',
      status: 'warn',
      message: `Plugin ships a Codex app connector (.app.json) that will NOT transfer. Skill instructions will copy over but the backing integration will not work on ${context.targetAgent}.`,
    });
  }

  if (artifacts.codexAgentSkills.length > 0 && context.targetAgent !== 'codex') {
    warnings.push({
      label: 'Codex agent YAML',
      status: 'warn',
      message: `Skills ${artifacts.codexAgentSkills.join(', ')} include Codex-specific agent YAML that will not transfer to ${context.targetAgent}.`,
    });
  }

  if (artifacts.hasHooks && context.targetAgent !== 'claude') {
    warnings.push({
      label: 'Claude hooks',
      status: 'warn',
      message: `Plugin ships session hooks that only work on Claude and will NOT transfer to ${context.targetAgent}.`,
    });
  }

  if (context.targetAgent === 'gemini' && artifacts.claudeAgents.length > 0) {
    warnings.push({
      label: 'Subagents',
      status: 'warn',
      message: `Plugin ships subagent definitions (${artifacts.claudeAgents.join(', ')}) that cannot be converted to ${context.targetAgent}.`,
    });
  }

  if (context.targetAgent === 'gemini' && artifacts.hasCommands) {
    warnings.push({
      label: 'Slash commands',
      status: 'warn',
      message: `Plugin ships slash commands that cannot be converted to ${context.targetAgent}.`,
    });
  }

  return warnings;
}
