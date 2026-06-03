import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import YAML from 'yaml';

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

  it('drops a selected profile item for one targeted agent', async () => {
    const tempProject = await mkdtemp(path.join(os.tmpdir(), 'brainctl-apply-drop-'));
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
        return {
          name: 'shared',
          skills: {},
          mcps: {
            docs: { kind: 'local', source: 'npm', package: '@modelcontextprotocol/server-filesystem' },
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
        return { agents: ['claude', 'codex'] };
      },
    };

    const writes: Array<{ agent: string; mcpServers: Record<string, unknown> }> = [];
    const writerFor = (agent: string): AgentConfigWriter => ({
      async write(args) {
        writes.push({ agent, mcpServers: args.mcpServers });
        return { configPath: `/tmp/${agent}`, backedUpTo: null };
      },
      async restore() {
        return { restoredFrom: '' };
      },
    });

    const service = createProfileApplyService({
      profileService,
      writers: { claude: writerFor('claude'), codex: writerFor('codex') },
    });

    const result = await service.execute({
      cwd: tempProject,
      profileName: 'shared',
      agents: ['claude', 'codex'],
      backup: false,
      itemActions: [{ agent: 'codex', type: 'mcp', name: 'docs', action: 'drop' }],
    });

    expect(writes).toEqual([
      {
        agent: 'claude',
        mcpServers: {
          docs: { kind: 'local', source: 'npm', package: '@modelcontextprotocol/server-filesystem' },
        },
      },
      { agent: 'codex', mcpServers: {} },
    ]);
    expect(result.applied.map((entry) => [entry.agent, entry.mcpCount])).toEqual([
      ['claude', 1],
      ['codex', 0],
    ]);
  });

  it('keeps both by applying a profile skill under a target name', async () => {
    const tempHome = await mkdtemp(path.join(os.tmpdir(), 'brainctl-apply-keep-home-'));
    const tempProject = await mkdtemp(path.join(os.tmpdir(), 'brainctl-apply-keep-proj-'));
    tempDirs.push(tempHome, tempProject);
    const originalHome = process.env.HOME;
    const originalBrainctlHome = process.env.BRAINCTL_HOME;
    process.env.HOME = tempHome;
    process.env.BRAINCTL_HOME = tempProject;

    try {
      const folder = path.join(tempProject, '.brainctl', 'profiles', 'shared');
      await mkdir(path.join(folder, 'skills', 'notes'), { recursive: true });
      await writeFile(
        path.join(folder, 'skills', 'notes', 'SKILL.md'),
        '# profile notes',
        'utf8'
      );
      await writeFile(
        path.join(folder, 'manifest.yaml'),
        [
          'schemaVersion: 3',
          'profileName: shared',
          'userSkills:',
          '  - agent: claude',
          '    name: notes',
          '    archivePath: skills/notes',
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
        writers: { claude: writer },
      });

      const result = await service.execute({
        cwd: tempProject,
        profileName: 'shared',
        agents: ['claude'],
        backup: false,
        itemActions: [
          { agent: 'claude', type: 'skill', name: 'notes', action: 'keep-both', targetName: 'notes-copy' },
        ],
      });

      expect(result.applied[0].userSkillsInstalled).toEqual(['notes-copy']);
      await expect(
        readFile(path.join(tempHome, '.claude', 'skills', 'notes-copy', 'SKILL.md'), 'utf8')
      ).resolves.toBe('# profile notes');
      await expect(
        readFile(path.join(tempHome, '.claude', 'skills', 'notes', 'SKILL.md'), 'utf8')
      ).rejects.toThrow();
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

  it('does not install plugin commands as standalone user skills when applying to Codex', async () => {
    const tempHome = await mkdtemp(path.join(os.tmpdir(), 'brainctl-apply-home-'));
    const tempProject = await mkdtemp(path.join(os.tmpdir(), 'brainctl-apply-proj-'));
    tempDirs.push(tempHome, tempProject);
    const originalHome = process.env.HOME;
    const originalBrainctlHome = process.env.BRAINCTL_HOME;
    process.env.HOME = tempHome;
    process.env.BRAINCTL_HOME = tempProject;

    try {
      const folder = path.join(tempProject, '.brainctl', 'profiles', 'shared');
      await mkdir(path.join(folder, 'plugins', 'demo', 'commands'), { recursive: true });
      await mkdir(path.join(folder, 'skills', 'ship-it'), { recursive: true });
      await writeFile(path.join(folder, 'plugins', 'demo', 'plugin.json'), '{}', 'utf8');
      await writeFile(
        path.join(folder, 'plugins', 'demo', 'commands', 'ship-it.md'),
        ['---', 'description: Ship a target', '---', '', 'Ship it.'].join('\n'),
        'utf8'
      );
      await writeFile(
        path.join(folder, 'skills', 'ship-it', 'SKILL.md'),
        ['---', 'description: Standalone duplicate', '---', '', 'Duplicate.'].join('\n'),
        'utf8'
      );
      await writeFile(
        path.join(folder, 'manifest.yaml'),
        YAML.stringify({
          schemaVersion: 3,
          profileName: 'shared',
          plugins: [
            {
              agent: 'claude',
              name: 'demo',
              source: 'market',
              archivePath: 'plugins/demo',
              pluginCommands: ['ship-it'],
            },
          ],
          userSkills: [
            { agent: 'claude', name: 'ship-it', archivePath: 'skills/ship-it' },
          ],
        }),
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
          return { agents: ['codex'] };
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
        writers: { codex: writer },
      });

      const result = await service.execute({
        cwd: tempProject,
        profileName: 'shared',
        agents: ['codex'],
        backup: false,
      });

      expect(result.applied[0].pluginsInstalled).toEqual(['demo']);
      expect(result.applied[0].userSkillsInstalled).toBeUndefined();
      await expect(
        readFile(path.join(tempHome, '.codex', 'skills', 'ship-it', 'SKILL.md'), 'utf8')
      ).resolves.toContain('Ship a target');
    } finally {
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
      if (originalBrainctlHome === undefined) delete process.env.BRAINCTL_HOME;
      else process.env.BRAINCTL_HOME = originalBrainctlHome;
    }
  });

  it('applies skills to both user and project scopes per manifest', async () => {
    const tempHome = await mkdtemp(path.join(os.tmpdir(), 'brainctl-apply-mixed-home-'));
    const tempProject = await mkdtemp(path.join(os.tmpdir(), 'brainctl-apply-mixed-proj-'));
    tempDirs.push(tempHome, tempProject);
    const originalHome = process.env.HOME;
    const originalBrainctlHome = process.env.BRAINCTL_HOME;
    process.env.HOME = tempHome;
    process.env.BRAINCTL_HOME = tempProject;

    try {
      const folder = path.join(tempProject, '.brainctl', 'profiles', 'mixed');
      await mkdir(path.join(folder, 'skills', 'user-thing'), { recursive: true });
      await writeFile(
        path.join(folder, 'skills', 'user-thing', 'SKILL.md'),
        '---\nname: user-thing\n---\n',
        'utf8'
      );
      await mkdir(path.join(folder, 'project-skills', 'proj-thing'), { recursive: true });
      await writeFile(
        path.join(folder, 'project-skills', 'proj-thing', 'SKILL.md'),
        '---\nname: proj-thing\n---\n',
        'utf8'
      );
      await writeFile(
        path.join(folder, 'manifest.yaml'),
        [
          'schemaVersion: 3',
          'profileName: mixed',
          'userSkills:',
          '  - agent: claude',
          '    name: user-thing',
          '    archivePath: skills/user-thing',
          '  - agent: claude',
          '    name: proj-thing',
          '    archivePath: project-skills/proj-thing',
          '    scope: project',
        ].join('\n'),
        'utf8'
      );

      const profileService: ProfileService = {
        async list() {
          return { profiles: ['mixed'] };
        },
        async get() {
          return { name: 'mixed', skills: {}, mcps: {}, memory: { paths: [] } };
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

      const writer: AgentConfigWriter = {
        async write() {
          return { configPath: '/tmp/c', backedUpTo: null };
        },
        async restore() {
          return { restoredFrom: '' };
        },
      };
      const snapshotService: ProfileSnapshotService = {
        async execute() {
          return { profilePath: '' };
        },
      };

      const service = createProfileApplyService({
        profileService,
        snapshotService,
        writers: { claude: writer },
      });

      await service.execute({
        cwd: tempProject,
        profileName: 'mixed',
        agents: ['claude'],
      });

      await expect(
        readFile(path.join(tempHome, '.claude', 'skills', 'user-thing', 'SKILL.md'), 'utf8')
      ).resolves.toContain('name: user-thing');
      await expect(
        readFile(path.join(tempProject, '.claude', 'skills', 'proj-thing', 'SKILL.md'), 'utf8')
      ).resolves.toContain('name: proj-thing');
      // proj-thing did NOT also go to user scope
      await expect(
        readFile(path.join(tempHome, '.claude', 'skills', 'proj-thing', 'SKILL.md'), 'utf8')
      ).rejects.toThrow();
    } finally {
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
      if (originalBrainctlHome === undefined) delete process.env.BRAINCTL_HOME;
      else process.env.BRAINCTL_HOME = originalBrainctlHome;
    }
  });
});
