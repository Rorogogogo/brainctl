import { copyFile, cp, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

import { ProfileError } from '../../errors.js';
import type {
  AgentName,
  PortablePluginSnapshot,
  PortableUserSkillSnapshot,
} from '../../types.js';
import {
  defaultReadInstalledPluginBundle,
  isAgentInstallableOnTarget,
  isCommandInstallableOnTarget,
} from '../plugin/plugin-install-bundle.js';
import {
  defaultCopySkillDirectory,
  defaultInstallAgent,
  defaultInstallCommand,
} from '../plugin/plugin-install-fs.js';
import { writeManagedPluginInstall } from '../sync/managed-plugin-registry.js';
import { formatTimestamp } from '../sync/agent-writer.js';

export async function installPlugin(
  sourceDir: string,
  plugin: PortablePluginSnapshot,
  targetAgent?: AgentName
): Promise<void> {
  try {
    await stat(sourceDir);
  } catch {
    throw new ProfileError(
      `Bundled plugin "${plugin.name}" source missing at ${sourceDir}.`
    );
  }

  const target = targetAgent ?? plugin.agent;

  if (target !== plugin.agent) {
    await installPluginCrossAgent(sourceDir, plugin, target);
    return;
  }

  if (plugin.agent === 'gemini') {
    return;
  }

  const marketplace = plugin.marketplace ?? plugin.source;
  const version = plugin.version ?? 'unknown';
  const cacheRoot = path.join(homedir(), `.${plugin.agent}`, 'plugins', 'cache');
  const targetDir = path.join(cacheRoot, marketplace, plugin.name, version);

  await rm(targetDir, { recursive: true, force: true });
  await mkdir(path.dirname(targetDir), { recursive: true });
  await cp(sourceDir, targetDir, { recursive: true });

  if (plugin.agent === 'claude') {
    await registerClaudePlugin({
      pluginKey: `${plugin.name}@${marketplace}`,
      installPath: targetDir,
      version,
    });
    return;
  }

  if (plugin.agent === 'codex') {
    await registerCodexPlugin({
      pluginKey: `${plugin.name}@${marketplace}`,
    });
  }
}

async function installPluginCrossAgent(
  sourceDir: string,
  plugin: PortablePluginSnapshot,
  targetAgent: AgentName
): Promise<void> {
  const bundle = await defaultReadInstalledPluginBundle(sourceDir);

  for (const skillName of bundle.skills) {
    await defaultCopySkillDirectory({
      sourceInstallPath: sourceDir,
      skillName,
      targetAgent,
    });
  }

  const installedAgents: string[] = [];
  if (isAgentInstallableOnTarget(targetAgent)) {
    for (const agent of bundle.agents) {
      await defaultInstallAgent({ targetAgent, agent });
      installedAgents.push(agent.name);
    }
  }

  const installedCommands: string[] = [];
  if (isCommandInstallableOnTarget(targetAgent)) {
    for (const command of bundle.commands) {
      await defaultInstallCommand({ targetAgent, command });
      installedCommands.push(command.name);
    }
  }

  await writeManagedPluginInstall({
    agent: targetAgent,
    plugin: {
      name: plugin.name,
      kind: 'plugin',
      managed: true,
      source: plugin.source,
      pluginSkills: bundle.skills,
      pluginMcps: Object.keys(bundle.mcps),
      pluginAgents: installedAgents,
      pluginCommands: installedCommands,
    },
  });
}

export async function installUserSkill(
  sourceDir: string,
  skill: PortableUserSkillSnapshot,
  targetAgent?: PortableUserSkillSnapshot['agent']
): Promise<void> {
  try {
    await stat(sourceDir);
  } catch {
    throw new ProfileError(
      `Bundled user skill "${skill.name}" source missing at ${sourceDir}.`
    );
  }

  const agent = targetAgent ?? skill.agent;
  const targetDir = path.join(homedir(), `.${agent}`, 'skills', skill.name);
  await rm(targetDir, { recursive: true, force: true });
  await mkdir(path.dirname(targetDir), { recursive: true });
  await cp(sourceDir, targetDir, { recursive: true });
}

async function registerClaudePlugin(options: {
  pluginKey: string;
  installPath: string;
  version: string;
}): Promise<void> {
  const filePath = path.join(homedir(), '.claude', 'plugins', 'installed_plugins.json');
  let existing: Record<string, unknown> = { version: 2, plugins: {} };

  try {
    const source = await readFile(filePath, 'utf8');
    existing = JSON.parse(source) as Record<string, unknown>;
    await backupFile(filePath);
  } catch {
    // fresh file
  }

  const plugins = (existing.plugins ?? {}) as Record<string, Array<Record<string, unknown>>>;
  const now = new Date().toISOString();
  const entry = {
    scope: 'user',
    installPath: options.installPath,
    version: options.version,
    installedAt: now,
    lastUpdated: now,
  };
  plugins[options.pluginKey] = [entry];
  existing.plugins = plugins;
  if (typeof existing.version !== 'number') existing.version = 2;

  await mkdir(path.dirname(filePath), { recursive: true });
  await atomicWrite(filePath, JSON.stringify(existing, null, 2) + '\n');
}

async function registerCodexPlugin(options: { pluginKey: string }): Promise<void> {
  const filePath = path.join(homedir(), '.codex', 'config.toml');
  let existing = '';
  try {
    existing = await readFile(filePath, 'utf8');
    await backupFile(filePath);
  } catch {
    existing = '';
  }

  const header = `[plugins."${options.pluginKey}"]`;
  if (existing.includes(header)) return;

  const prefix = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
  const separator = existing.length > 0 ? '\n' : '';
  const block = `${header}\nenabled = true\n`;
  const next = existing + prefix + separator + block;

  await mkdir(path.dirname(filePath), { recursive: true });
  await atomicWrite(filePath, next);
}

async function backupFile(filePath: string): Promise<void> {
  const backupPath = `${filePath}.bak.${formatTimestamp()}`;
  try {
    await copyFile(filePath, backupPath);
  } catch {
    // file may not exist
  }
}

async function atomicWrite(filePath: string, content: string): Promise<void> {
  const tmpPath = `${filePath}.tmp.${Date.now()}`;
  await writeFile(tmpPath, content, 'utf8');
  await rename(tmpPath, filePath);
}
