import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import YAML from 'yaml';
import { afterEach, describe, expect, it } from 'vitest';

import { installPlugin, installUserSkill } from '../../src/services/agent/agent-asset-installer.js';

describe('installUserSkill', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('normalizes frontmatter when installing user skills into Codex', async () => {
    const tempHome = await mkdtemp(path.join(os.tmpdir(), 'brainctl-skill-home-'));
    const sourceDir = await mkdtemp(path.join(os.tmpdir(), 'brainctl-skill-source-'));
    tempDirs.push(tempHome, sourceDir);
    const originalHome = process.env.HOME;
    process.env.HOME = tempHome;

    try {
      await mkdir(sourceDir, { recursive: true });
      await writeFile(
        path.join(sourceDir, 'SKILL.md'),
        [
          '---',
          'name: notes',
          'description: Manage personal notes',
          'disable-model-invocation: true',
          'user-invocable: true',
          'argument-hint: [action] [details]',
          '---',
          '',
          'Use the notes system.',
        ].join('\n'),
        'utf8'
      );

      await installUserSkill(sourceDir, { agent: 'claude', name: 'notes', archivePath: 'skills/notes' }, 'codex');

      const installed = await readFile(
        path.join(tempHome, '.codex', 'skills', 'notes', 'SKILL.md'),
        'utf8'
      );
      const frontmatter = installed.split('---')[1];

      expect(() => YAML.parse(frontmatter)).not.toThrow();
      expect(YAML.parse(frontmatter)).toMatchObject({
        name: 'notes',
        'argument-hint': '[action] [details]',
      });
    } finally {
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
    }
  });
});

describe('installUserSkill project scope', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('writes project-scoped skills into <cwd>/.claude/skills/', async () => {
    const tempHome = await mkdtemp(path.join(os.tmpdir(), 'brainctl-pscope-home-'));
    const sourceDir = await mkdtemp(path.join(os.tmpdir(), 'brainctl-pscope-src-'));
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'brainctl-pscope-cwd-'));
    tempDirs.push(tempHome, sourceDir, cwd);
    const originalHome = process.env.HOME;
    process.env.HOME = tempHome;

    try {
      await writeFile(
        path.join(sourceDir, 'SKILL.md'),
        ['---', 'name: lint', 'description: lint things', '---', '', 'body'].join('\n'),
        'utf8'
      );

      await installUserSkill(
        sourceDir,
        { agent: 'claude', name: 'lint', archivePath: 'project-skills/lint', scope: 'project' },
        'claude',
        { cwd }
      );

      const installed = await readFile(
        path.join(cwd, '.claude', 'skills', 'lint', 'SKILL.md'),
        'utf8'
      );
      expect(installed).toContain('name: lint');

      // Make sure it did NOT also land in the user-scope location.
      await expect(
        readFile(path.join(tempHome, '.claude', 'skills', 'lint', 'SKILL.md'), 'utf8')
      ).rejects.toThrow();
    } finally {
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
    }
  });

  it('throws when project scope is requested without a cwd', async () => {
    const sourceDir = await mkdtemp(path.join(os.tmpdir(), 'brainctl-pscope-src2-'));
    tempDirs.push(sourceDir);
    await writeFile(path.join(sourceDir, 'SKILL.md'), '---\nname: x\n---\n', 'utf8');

    await expect(
      installUserSkill(
        sourceDir,
        { agent: 'claude', name: 'x', archivePath: 'project-skills/x', scope: 'project' },
        'claude'
      )
    ).rejects.toThrow(/cwd/);
  });
});

describe('installPlugin', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('converts Claude commands without description frontmatter when applying a plugin to Codex', async () => {
    const tempHome = await mkdtemp(path.join(os.tmpdir(), 'brainctl-plugin-home-'));
    const sourceDir = await mkdtemp(path.join(os.tmpdir(), 'brainctl-plugin-source-'));
    tempDirs.push(tempHome, sourceDir);
    const originalHome = process.env.HOME;
    process.env.HOME = tempHome;

    try {
      await mkdir(path.join(sourceDir, 'commands'), { recursive: true });
      await writeFile(
        path.join(sourceDir, 'commands', 'ship-it.md'),
        ['---', 'argument-hint: [target]', '---', '', 'Ship the target.'].join('\n'),
        'utf8'
      );

      await installPlugin(
        sourceDir,
        {
          agent: 'claude',
          name: 'demo',
          source: 'market',
          archivePath: 'plugins/demo',
        },
        'codex'
      );

      const installed = await readFile(
        path.join(tempHome, '.codex', 'skills', 'ship-it', 'SKILL.md'),
        'utf8'
      );
      const frontmatter = YAML.parse(installed.split('---')[1]) as Record<string, unknown>;

      expect(frontmatter.description).toBe('Run the ship-it command.');
      expect(frontmatter['argument-hint']).toBe('[target]');
    } finally {
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
    }
  });
});
