import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  mergeManagedPluginsIntoSkills,
  readManagedPlugins,
  removeManagedPluginInstall,
  writeManagedPluginInstall,
} from '../src/services/sync/managed-plugin-registry.js';
import type { AgentSkillEntry } from '../src/services/sync/agent-reader.js';

const tempDirs: string[] = [];

describe('managed plugin registry', () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('writes and reads managed plugins per agent', async () => {
    const homeDir = await mkdtemp(path.join(os.tmpdir(), 'brainctl-managed-plugins-'));
    tempDirs.push(homeDir);

    await writeManagedPluginInstall({
      homeDir,
      agent: 'codex',
      plugin: {
        name: 'frontend-design',
        source: 'claude-plugins-official',
        kind: 'plugin',
        installPath: '/tmp/frontend-design',
        pluginSkills: ['frontend-design'],
      },
    });

    const plugins = await readManagedPlugins({ homeDir, agent: 'codex' });

    expect(plugins).toEqual([
      {
        name: 'frontend-design',
        source: 'claude-plugins-official',
        kind: 'plugin',
        installPath: '/tmp/frontend-design',
        pluginSkills: ['frontend-design'],
        managed: true,
      },
    ]);
  });

  it('removes managed plugins by name for a specific agent', async () => {
    const homeDir = await mkdtemp(path.join(os.tmpdir(), 'brainctl-managed-plugins-'));
    tempDirs.push(homeDir);

    await writeManagedPluginInstall({
      homeDir,
      agent: 'codex',
      plugin: {
        name: 'frontend-design',
        source: 'claude-plugins-official',
        kind: 'plugin',
        installPath: '/tmp/frontend-design',
        pluginSkills: ['frontend-design'],
      },
    });

    await removeManagedPluginInstall({
      homeDir,
      agent: 'codex',
      pluginName: 'frontend-design',
    });

    await expect(readManagedPlugins({ homeDir, agent: 'codex' })).resolves.toEqual([]);
  });

  it('hides plugin-owned skills from the plain skill list after merge', () => {
    const localSkills: AgentSkillEntry[] = [
      { name: 'frontend-design', source: 'local', kind: 'skill' },
      { name: 'notes', source: 'local', kind: 'skill' },
    ];
    const managedPlugins: AgentSkillEntry[] = [
      {
        name: 'frontend-design',
        source: 'claude-plugins-official',
        kind: 'plugin',
        managed: true,
        installPath: '/tmp/frontend-design',
        pluginSkills: ['frontend-design'],
      },
    ];

    const merged = mergeManagedPluginsIntoSkills(localSkills, managedPlugins);

    expect(merged).toEqual([
      {
        name: 'frontend-design',
        source: 'claude-plugins-official',
        kind: 'plugin',
        installPath: '/tmp/frontend-design',
        pluginSkills: ['frontend-design'],
        managed: true,
      },
      { name: 'notes', source: 'local', kind: 'skill' },
    ]);
  });
});
