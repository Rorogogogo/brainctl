import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

import type { AgentName } from '../../types.js';
import type { AgentSkillEntry } from './agent-reader.js';

interface ManagedPluginRegistryFile {
  version: 1;
  agents?: Partial<Record<AgentName, AgentSkillEntry[]>>;
}

function getRegistryPath(homeDir: string): string {
  return path.join(homeDir, '.brainctl', 'managed-plugins.json');
}

export async function readManagedPlugins(options: {
  homeDir?: string;
  agent: AgentName;
}): Promise<AgentSkillEntry[]> {
  const homeDir = options.homeDir ?? homedir();
  const registryPath = getRegistryPath(homeDir);

  try {
    const source = await readFile(registryPath, 'utf8');
    const parsed = JSON.parse(source) as ManagedPluginRegistryFile;
    return (parsed.agents?.[options.agent] ?? []).map((entry) => ({
      ...entry,
      kind: 'plugin',
      managed: true,
    }));
  } catch {
    return [];
  }
}

export async function writeManagedPluginInstall(options: {
  homeDir?: string;
  agent: AgentName;
  plugin: AgentSkillEntry;
}): Promise<void> {
  const homeDir = options.homeDir ?? homedir();
  const registryPath = getRegistryPath(homeDir);
  const existing = await readRegistryFile(homeDir);
  const currentEntries = existing.agents?.[options.agent] ?? [];
  const nextEntries = [
    ...currentEntries.filter((entry) => entry.name !== options.plugin.name),
    {
      ...options.plugin,
      kind: 'plugin' as const,
      managed: true,
    },
  ].sort((left, right) => left.name.localeCompare(right.name));

  const next: ManagedPluginRegistryFile = {
    version: 1,
    agents: {
      ...existing.agents,
      [options.agent]: nextEntries,
    },
  };

  await mkdir(path.dirname(registryPath), { recursive: true });
  await writeFile(registryPath, JSON.stringify(next, null, 2) + '\n', 'utf8');
}

export async function removeManagedPluginInstall(options: {
  homeDir?: string;
  agent: AgentName;
  pluginName: string;
}): Promise<void> {
  const homeDir = options.homeDir ?? homedir();
  const registryPath = getRegistryPath(homeDir);
  const existing = await readRegistryFile(homeDir);
  const currentEntries = existing.agents?.[options.agent] ?? [];
  const nextEntries = currentEntries.filter((entry) => entry.name !== options.pluginName);

  const next: ManagedPluginRegistryFile = {
    version: 1,
    agents: {
      ...existing.agents,
      [options.agent]: nextEntries,
    },
  };

  await mkdir(path.dirname(registryPath), { recursive: true });
  await writeFile(registryPath, JSON.stringify(next, null, 2) + '\n', 'utf8');
}

export function mergeManagedPluginsIntoSkills(
  localSkills: AgentSkillEntry[],
  managedPlugins: AgentSkillEntry[]
): AgentSkillEntry[] {
  const pluginOwnedSkills = new Set(
    managedPlugins.flatMap((plugin) => plugin.pluginSkills ?? [])
  );

  const filteredLocalSkills = localSkills.filter((skill) => !pluginOwnedSkills.has(skill.name));
  return [...managedPlugins, ...filteredLocalSkills];
}

async function readRegistryFile(homeDir: string): Promise<ManagedPluginRegistryFile> {
  try {
    const source = await readFile(getRegistryPath(homeDir), 'utf8');
    return JSON.parse(source) as ManagedPluginRegistryFile;
  } catch {
    return { version: 1, agents: {} };
  }
}
