import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ProfileError } from '../../src/errors.js';
import { createProfileApplyService } from '../../src/services/profile/profile-apply-service.js';
import type { ProfileService } from '../../src/services/profile/profile-service.js';
import type { ProfileSnapshotService } from '../../src/services/profile/profile-snapshot-service.js';
import type { AgentConfigWriter } from '../../src/services/sync/agent-writer.js';

describe('createProfileApplyService', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
    );
  });

  it('rejects profiles with remote MCPs', async () => {
    const profileService: ProfileService = {
      async list() {
        return { profiles: ['p'] };
      },
      async get() {
        return {
          name: 'p',
          skills: {},
          mcps: {
            docs: { kind: 'remote', transport: 'http', url: 'https://x' },
          },
          memory: { paths: [] },
        };
      },
      async create() {
        return { profilePath: '' };
      },
      async update() {},
      async delete() {},
      async getMetaConfig() {
        return { agents: ['claude'] };
      },
    };

    const service = createProfileApplyService({ profileService });
    await expect(
      service.execute({ profileName: 'p', agents: ['claude'] })
    ).rejects.toBeInstanceOf(ProfileError);
  });

  it('applies only the selected items to the targeted agent and skips backup for partial', async () => {
    const tempHome = await mkdtemp(path.join(os.tmpdir(), 'brainctl-apply-home-'));
    const tempProject = await mkdtemp(path.join(os.tmpdir(), 'brainctl-apply-proj-'));
    tempDirs.push(tempHome, tempProject);
    const originalHome = process.env.HOME;
    const originalBrainctlHome = process.env.BRAINCTL_HOME;
    process.env.HOME = tempHome;
    process.env.BRAINCTL_HOME = tempProject;

    try {
      // Set up a profile folder with a manifest declaring 1 plugin + 2 skills
      const folder = path.join(tempProject, '.brainctl', 'profiles', 'shared');
      await mkdir(path.join(folder, 'plugins', 'claude', 'demo--mp'), {
        recursive: true,
      });
      await writeFile(
        path.join(folder, 'plugins', 'claude', 'demo--mp', 'plugin.json'),
        '{"name":"demo"}',
        'utf8'
      );
      await mkdir(path.join(folder, 'skills', 'claude', 'reviewer'), { recursive: true });
      await writeFile(
        path.join(folder, 'skills', 'claude', 'reviewer', 'SKILL.md'),
        '# r',
        'utf8'
      );
      await mkdir(path.join(folder, 'skills', 'claude', 'tester'), { recursive: true });
      await writeFile(
        path.join(folder, 'skills', 'claude', 'tester', 'SKILL.md'),
        '# t',
        'utf8'
      );
      await writeFile(
        path.join(folder, 'manifest.yaml'),
        [
          'schemaVersion: 2',
          'profileName: shared',
          'plugins:',
          '  - agent: claude',
          '    name: demo',
          '    source: mp',
          '    marketplace: mp',
          '    version: 1.0.0',
          '    archivePath: plugins/claude/demo--mp',
          'userSkills:',
          '  - agent: claude',
          '    name: reviewer',
          '    archivePath: skills/claude/reviewer',
          '  - agent: claude',
          '    name: tester',
          '    archivePath: skills/claude/tester',
        ].join('\n'),
        'utf8'
      );

      const profileService: ProfileService = {
        async list() {
          return { profiles: ['shared'] };
        },
        async get() {
          return { name: 'shared', skills: {}, mcps: {}, memory: { paths: [] } };
        },
        async create() {
          return { profilePath: '' };
        },
        async update() {},
        async delete() {},
        async getMetaConfig() {
          return { agents: ['claude'] };
        },
      };

      const writes: any[] = [];
      const writer: AgentConfigWriter = {
        async write(args) {
          writes.push(args);
          return { configPath: '/tmp/c', backedUpTo: null };
        },
        async restore() {
          return { restoredFrom: '' };
        },
      };

      const snapshotCalls: any[] = [];
      const snapshotService: ProfileSnapshotService = {
        async execute(opts) {
          snapshotCalls.push(opts);
          return { profilePath: path.join(folder, '..', opts.profileName) };
        },
      };

      const service = createProfileApplyService({
        profileService,
        snapshotService,
        writers: { claude: writer },
      });

      // Partial: only the reviewer skill
      const result = await service.execute({
        cwd: tempProject,
        profileName: 'shared',
        agents: ['claude'],
        items: [{ type: 'skill', name: 'reviewer' }],
      });

      expect(result.backups).toEqual([]); // no backup for partial
      expect(snapshotCalls).toEqual([]);
      expect(result.applied[0].userSkillsInstalled).toEqual(['reviewer']);
      expect(result.applied[0].pluginsInstalled).toBeUndefined();
      // tester wasn't installed
      await expect(
        readFile(path.join(tempHome, '.claude', 'skills', 'tester', 'SKILL.md'), 'utf8')
      ).rejects.toThrow();
      // reviewer was
      await expect(
        readFile(path.join(tempHome, '.claude', 'skills', 'reviewer', 'SKILL.md'), 'utf8')
      ).resolves.toBe('# r');
    } finally {
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
      if (originalBrainctlHome === undefined) delete process.env.BRAINCTL_HOME;
      else process.env.BRAINCTL_HOME = originalBrainctlHome;
    }
  });

  it('runs auto-backup on full apply', async () => {
    const tempProject = await mkdtemp(path.join(os.tmpdir(), 'brainctl-apply-full-'));
    tempDirs.push(tempProject);

    const folder = path.join(tempProject, '.brainctl', 'profiles', 'shared');
    await mkdir(folder, { recursive: true });
    await writeFile(
      path.join(folder, 'manifest.yaml'),
      ['schemaVersion: 1', 'profileName: shared'].join('\n'),
      'utf8'
    );

    const profileService: ProfileService = {
      async list() {
        return { profiles: ['shared'] };
      },
      async get() {
        return { name: 'shared', skills: {}, mcps: {}, memory: { paths: [] } };
      },
      async create() {
        return { profilePath: '' };
      },
      async update() {},
      async delete() {},
      async getMetaConfig() {
        return { agents: ['claude', 'codex'] };
      },
    };

    const snapshotCalls: any[] = [];
    const snapshotService: ProfileSnapshotService = {
      async execute(opts) {
        snapshotCalls.push(opts);
        return { profilePath: '' };
      },
    };

    const writer: AgentConfigWriter = {
      async write() {
        return { configPath: '/tmp/c', backedUpTo: null };
      },
      async restore() {
        return { restoredFrom: '' };
      },
    };

    const service = createProfileApplyService({
      profileService,
      snapshotService,
      writers: { claude: writer, codex: writer },
    });

    const result = await service.execute({
      cwd: tempProject,
      profileName: 'shared',
      agents: ['claude', 'codex'],
    });

    expect(snapshotCalls.map((c) => c.agent)).toEqual(['claude', 'codex']);
    expect(result.backups).toHaveLength(2);
  });
});
