import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import type { AgentSkillEntry } from './agent-reader.js';

interface InstalledPluginRecord {
  installPath?: string;
}

interface InstalledPluginsFile {
  plugins?: Record<string, InstalledPluginRecord[]>;
}

export async function readInstalledPlugins(installedPluginsPath: string): Promise<AgentSkillEntry[]> {
  const source = await readFile(installedPluginsPath, 'utf8');
  const data = JSON.parse(source) as InstalledPluginsFile;
  const results: AgentSkillEntry[] = [];

  for (const [key, records] of Object.entries(data.plugins ?? {})) {
    const [name, pluginSource] = key.split('@');
    const installPath = records[0]?.installPath;
    const pluginSkills = installPath ? await readPluginSkills(installPath) : [];

    results.push({
      name,
      source: pluginSource,
      kind: 'plugin',
      installPath,
      pluginSkills,
    });
  }

  return results;
}

async function readPluginSkills(installPath: string): Promise<string[]> {
  const skillsDir = path.join(installPath, 'skills');

  try {
    const entries = await readdir(skillsDir, { withFileTypes: true });
    return entries
      .filter((entry) => !entry.name.startsWith('.') && entry.isDirectory())
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));
  } catch {
    return [];
  }
}
