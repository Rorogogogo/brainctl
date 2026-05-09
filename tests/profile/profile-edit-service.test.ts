import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import YAML from 'yaml';
import { afterEach, describe, expect, it } from 'vitest';

import { createProfileEditService } from '../../src/services/profile/profile-edit-service.js';
import type { ProfileService } from '../../src/services/profile/profile-service.js';

describe('createProfileEditService', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('removes plugin-owned user skills when removing the plugin from a profile', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'brainctl-profile-edit-'));
    tempDirs.push(root);
    const originalBrainctlHome = process.env.BRAINCTL_HOME;
    process.env.BRAINCTL_HOME = root;

    try {
      const profileFolder = path.join(root, '.brainctl', 'profiles', 'team');
      await mkdir(path.join(profileFolder, 'plugins', 'demo'), { recursive: true });
      await mkdir(path.join(profileFolder, 'skills', 'inner'), { recursive: true });
      await mkdir(path.join(profileFolder, 'skills', 'personal'), { recursive: true });
      await writeFile(path.join(profileFolder, 'plugins', 'demo', 'plugin.json'), '{}', 'utf8');
      await writeFile(path.join(profileFolder, 'skills', 'inner', 'SKILL.md'), '# inner', 'utf8');
      await writeFile(path.join(profileFolder, 'skills', 'personal', 'SKILL.md'), '# personal', 'utf8');
      await writeFile(
        path.join(profileFolder, 'manifest.yaml'),
        YAML.stringify({
          schemaVersion: 3,
          profileName: 'team',
          plugins: [
            {
              agent: 'codex',
              name: 'demo',
              source: 'market',
              archivePath: 'plugins/demo',
              pluginSkills: ['inner'],
            },
          ],
          userSkills: [
            { agent: 'codex', name: 'inner', archivePath: 'skills/inner' },
            { agent: 'codex', name: 'personal', archivePath: 'skills/personal' },
          ],
        }),
        'utf8'
      );

      const profileService: ProfileService = {
        async list() {
          return { profiles: ['team'] };
        },
        async get() {
          return { name: 'team', mcps: {} };
        },
        async create() {
          return { profilePath: '' };
        },
        async update() {},
        async rename() {},
        async delete() {},
      };

      const service = createProfileEditService({ profileService });

      await service.removeItem({
        cwd: root,
        profileName: 'team',
        type: 'plugin',
        name: 'demo',
        agent: 'codex',
      });

      const manifest = YAML.parse(
        await readFile(path.join(profileFolder, 'manifest.yaml'), 'utf8')
      ) as { plugins?: unknown[]; userSkills?: Array<{ name: string }> };

      expect(manifest.plugins).toEqual([]);
      expect(manifest.userSkills).toEqual([
        { agent: 'codex', name: 'personal', archivePath: 'skills/personal' },
      ]);
      await expect(readFile(path.join(profileFolder, 'skills', 'inner', 'SKILL.md'), 'utf8')).rejects.toThrow();
      await expect(readFile(path.join(profileFolder, 'skills', 'personal', 'SKILL.md'), 'utf8')).resolves.toContain('personal');
    } finally {
      if (originalBrainctlHome === undefined) delete process.env.BRAINCTL_HOME;
      else process.env.BRAINCTL_HOME = originalBrainctlHome;
    }
  });
});
