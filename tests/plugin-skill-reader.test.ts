import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { readInstalledPlugins } from '../src/services/sync/plugin-skill-reader.js';

const tempDirs: string[] = [];

describe('readInstalledPlugins', () => {
  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map(async (dir) => {
        await import('node:fs/promises').then(({ rm }) =>
          rm(dir, { recursive: true, force: true })
        );
      })
    );
  });

  it('returns plugin-owned skills discovered from the install path', async () => {
    const baseDir = await mkdtemp(path.join(os.tmpdir(), 'brainctl-plugin-reader-'));
    tempDirs.push(baseDir);

    const installPath = path.join(baseDir, 'cache', 'superpowers', '5.0.6');
    await mkdir(path.join(installPath, 'skills', 'test-driven-development'), { recursive: true });
    await mkdir(path.join(installPath, 'skills', 'systematic-debugging'), { recursive: true });

    await writeFile(
      path.join(baseDir, 'installed_plugins.json'),
      JSON.stringify({
        version: 2,
        plugins: {
          'superpowers@claude-plugins-official': [
            {
              installPath,
              version: '5.0.6',
            },
          ],
        },
      }),
      'utf8'
    );

    const plugins = await readInstalledPlugins(path.join(baseDir, 'installed_plugins.json'));

    expect(plugins).toEqual([
      {
        installPath,
        name: 'superpowers',
        source: 'claude-plugins-official',
        kind: 'plugin',
        pluginSkills: ['systematic-debugging', 'test-driven-development'],
      },
    ]);
  });

  it('returns an empty skill list for plugins without a skills directory', async () => {
    const baseDir = await mkdtemp(path.join(os.tmpdir(), 'brainctl-plugin-reader-'));
    tempDirs.push(baseDir);

    const installPath = path.join(baseDir, 'cache', 'context7', 'unknown');
    await mkdir(installPath, { recursive: true });

    await writeFile(
      path.join(baseDir, 'installed_plugins.json'),
      JSON.stringify({
        version: 2,
        plugins: {
          'context7@claude-plugins-official': [
            {
              installPath,
              version: 'unknown',
            },
          ],
        },
      }),
      'utf8'
    );

    const plugins = await readInstalledPlugins(path.join(baseDir, 'installed_plugins.json'));

    expect(plugins).toEqual([
      {
        installPath,
        name: 'context7',
        source: 'claude-plugins-official',
        kind: 'plugin',
        pluginSkills: [],
      },
    ]);
  });
});
