import { execSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import YAML from 'yaml';
import { afterEach, describe, expect, it } from 'vitest';

import { ProfileError } from '../../src/errors.js';
import { createProfileImportService } from '../../src/services/profile/profile-import-service.js';

describe('createProfileImportService portable unpack', () => {
  const tempDirs: string[] = [];
  const originalBrainctlHome = process.env.BRAINCTL_HOME;

  afterEach(async () => {
    if (originalBrainctlHome === undefined) delete process.env.BRAINCTL_HOME;
    else process.env.BRAINCTL_HOME = originalBrainctlHome;
    await Promise.all(
      tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
    );
  });

  it('installs bundled MCPs from the path declared in the portable profile', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'brainctl-unpack-'));
    tempDirs.push(root);

    const projectDir = path.join(root, 'workspace');
    const archiveStageDir = path.join(root, 'archive-stage');
    await mkdir(projectDir, { recursive: true });
    process.env.BRAINCTL_HOME = projectDir;
    await mkdir(path.join(archiveStageDir, 'bundle', 'server'), { recursive: true });
    await writeFile(
      path.join(archiveStageDir, 'bundle', 'server', 'package.json'),
      '{"name":"demo-server","version":"1.0.0"}',
      'utf8'
    );
    await writeFile(
      path.join(archiveStageDir, 'manifest.yaml'),
      [
        'schemaVersion: 1',
        'profileName: imported',
        'source:',
        '  kind: profile',
        '  profileName: imported',
      ].join('\n'),
      'utf8'
    );
    await writeFile(
      path.join(archiveStageDir, 'profile.yaml'),
      [
        'name: imported',
        'skills: {}',
        'mcps:',
        '  demo:',
        '    kind: local',
        '    source: bundled',
        '    path: ./bundle/server',
        '    install: npm install',
        '    command: node',
        'memory:',
        '  paths:',
        '    - ./memory',
      ].join('\n'),
      'utf8'
    );

    const archivePath = path.join(projectDir, 'imported.tar.gz');
    execSync(`tar -czf "${archivePath}" -C "${archiveStageDir}" .`);

    const service = createProfileImportService();
    const result = await service.execute({
      cwd: projectDir,
      archivePath,
    });

    expect(result).toEqual({
      profileName: 'imported',
      installedMcps: ['demo'],
      installedPlugins: [],
      installedUserSkills: [],
      requiredCredentials: [],
    });

    const installedProfile = YAML.parse(
      await readFile(path.join(projectDir, '.brainctl', 'profiles', 'imported', 'profile.yaml'), 'utf8')
    ) as Record<string, any>;
    expect(installedProfile.mcps.demo.path).toBe(
      path.join(projectDir, '.brainctl', 'profiles', 'imported', 'mcps', 'demo')
    );
    await expect(
      readFile(
        path.join(projectDir, '.brainctl', 'profiles', 'imported', 'mcps', 'demo', 'package.json'),
        'utf8'
      )
    ).resolves.toContain('"name":"demo-server"');
  });

  it('rejects archives with an unsupported portable schema version', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'brainctl-unpack-'));
    tempDirs.push(root);

    const projectDir = path.join(root, 'workspace');
    const archiveStageDir = path.join(root, 'archive-stage');
    await mkdir(projectDir, { recursive: true });
    process.env.BRAINCTL_HOME = projectDir;
    await mkdir(archiveStageDir, { recursive: true });
    await writeFile(
      path.join(archiveStageDir, 'manifest.yaml'),
      ['schemaVersion: 4', 'profileName: unsupported'].join('\n'),
      'utf8'
    );
    await writeFile(
      path.join(archiveStageDir, 'profile.yaml'),
      ['name: unsupported', 'skills: {}', 'mcps: {}', 'memory:', '  paths: []'].join('\n'),
      'utf8'
    );

    const archivePath = path.join(projectDir, 'unsupported.tar.gz');
    execSync(`tar -czf "${archivePath}" -C "${archiveStageDir}" .`);

    const service = createProfileImportService();

    await expect(
      service.execute({
        cwd: projectDir,
        archivePath,
      })
    ).rejects.toThrowError(
      new ProfileError('Unsupported portable profile schema version: 4.')
    );
  });

  it('rejects bundled MCP paths that escape the extracted archive root', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'brainctl-unpack-'));
    tempDirs.push(root);

    const projectDir = path.join(root, 'workspace');
    const archiveStageDir = path.join(root, 'archive-stage');
    await mkdir(projectDir, { recursive: true });
    process.env.BRAINCTL_HOME = projectDir;
    await mkdir(archiveStageDir, { recursive: true });
    await writeFile(
      path.join(archiveStageDir, 'manifest.yaml'),
      [
        'schemaVersion: 1',
        'profileName: imported',
        'source:',
        '  kind: profile',
        '  profileName: imported',
      ].join('\n'),
      'utf8'
    );
    await writeFile(
      path.join(archiveStageDir, 'profile.yaml'),
      [
        'name: imported',
        'skills: {}',
        'mcps:',
        '  demo:',
        '    kind: local',
        '    source: bundled',
        '    path: ../outside',
        '    command: node',
        'memory:',
        '  paths:',
        '    - ./memory',
      ].join('\n'),
      'utf8'
    );

    const archivePath = path.join(projectDir, 'imported.tar.gz');
    execSync(`tar -czf "${archivePath}" -C "${archiveStageDir}" .`);

    const service = createProfileImportService();

    await expect(
      service.execute({
        cwd: projectDir,
        archivePath,
      })
    ).rejects.toThrowError(
      new ProfileError('Bundled MCP path "../outside" escapes the archive root.')
    );
  });

  it('removes stale bundled MCP files on force import before copying the new archive contents', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'brainctl-unpack-'));
    tempDirs.push(root);

    const projectDir = path.join(root, 'workspace');
    const firstStageDir = path.join(root, 'archive-stage-first');
    const secondStageDir = path.join(root, 'archive-stage-second');
    await mkdir(projectDir, { recursive: true });
    process.env.BRAINCTL_HOME = projectDir;
    await mkdir(path.join(firstStageDir, 'bundle', 'server'), { recursive: true });
    await mkdir(path.join(secondStageDir, 'bundle', 'server'), { recursive: true });

    await writeFile(
      path.join(firstStageDir, 'bundle', 'server', 'package.json'),
      '{"name":"demo-server","version":"1.0.0"}',
      'utf8'
    );
    await writeFile(path.join(firstStageDir, 'bundle', 'server', 'old.txt'), 'old', 'utf8');
    await writeFile(
      path.join(secondStageDir, 'bundle', 'server', 'package.json'),
      '{"name":"demo-server","version":"1.0.1"}',
      'utf8'
    );
    await writeFile(path.join(secondStageDir, 'bundle', 'server', 'new.txt'), 'new', 'utf8');

    for (const stageDir of [firstStageDir, secondStageDir]) {
      await writeFile(
        path.join(stageDir, 'manifest.yaml'),
        [
          'schemaVersion: 1',
          'profileName: imported',
          'source:',
          '  kind: profile',
          '  profileName: imported',
        ].join('\n'),
        'utf8'
      );
      await writeFile(
        path.join(stageDir, 'profile.yaml'),
        [
          'name: imported',
          'skills: {}',
          'mcps:',
          '  demo:',
          '    kind: local',
          '    source: bundled',
          '    path: ./bundle/server',
          '    install: npm install',
          '    command: node',
          'memory:',
          '  paths:',
          '    - ./memory',
        ].join('\n'),
        'utf8'
      );
    }

    const firstArchivePath = path.join(projectDir, 'imported-first.tar.gz');
    const secondArchivePath = path.join(projectDir, 'imported-second.tar.gz');
    execSync(`tar -czf "${firstArchivePath}" -C "${firstStageDir}" .`);
    execSync(`tar -czf "${secondArchivePath}" -C "${secondStageDir}" .`);

    const service = createProfileImportService();
    await service.execute({
      cwd: projectDir,
      archivePath: firstArchivePath,
    });
    await service.execute({
      cwd: projectDir,
      archivePath: secondArchivePath,
      force: true,
    });

    const installedDir = path.join(projectDir, '.brainctl', 'profiles', 'imported', 'mcps', 'demo');
    await expect(readFile(path.join(installedDir, 'new.txt'), 'utf8')).resolves.toBe('new');
    await expect(readFile(path.join(installedDir, 'old.txt'), 'utf8')).rejects.toThrow();
  });

  it('reports missing required credentials without blocking the import', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'brainctl-unpack-'));
    tempDirs.push(root);

    const projectDir = path.join(root, 'workspace');
    const archiveStageDir = path.join(root, 'archive-stage');
    await mkdir(projectDir, { recursive: true });
    process.env.BRAINCTL_HOME = projectDir;
    await mkdir(archiveStageDir, { recursive: true });
    await writeFile(
      path.join(archiveStageDir, 'manifest.yaml'),
      [
        'schemaVersion: 1',
        'profileName: imported',
        'credentials:',
        '  - key: db_password',
        '    required: true',
        'source:',
        '  kind: profile',
        '  profileName: imported',
      ].join('\n'),
      'utf8'
    );
    await writeFile(
      path.join(archiveStageDir, 'profile.yaml'),
      [
        'name: imported',
        'skills: {}',
        'mcps:',
        '  db:',
        '    kind: local',
        '    source: npm',
        '    package: "@modelcontextprotocol/server-postgres"',
        '    env:',
        '      DB_PASSWORD: ${credentials.db_password}',
        'memory:',
        '  paths: []',
      ].join('\n'),
      'utf8'
    );

    const archivePath = path.join(projectDir, 'imported.tar.gz');
    execSync(`tar -czf "${archivePath}" -C "${archiveStageDir}" .`);

    const service = createProfileImportService();

    const result = await service.execute({
      cwd: projectDir,
      archivePath,
    });

    expect(result.requiredCredentials.map((c) => c.key)).toContain('db_password');
  });

  it('resolves supplied credentials before persisting the imported profile and leaves optional placeholders intact', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'brainctl-unpack-'));
    tempDirs.push(root);

    const projectDir = path.join(root, 'workspace');
    const archiveStageDir = path.join(root, 'archive-stage');
    await mkdir(projectDir, { recursive: true });
    process.env.BRAINCTL_HOME = projectDir;
    await mkdir(archiveStageDir, { recursive: true });
    await writeFile(
      path.join(archiveStageDir, 'manifest.yaml'),
      [
        'schemaVersion: 1',
        'profileName: imported',
        'credentials:',
        '  - key: github_token',
        '    required: true',
        '  - key: optional_token',
        '    required: false',
        'source:',
        '  kind: profile',
        '  profileName: imported',
      ].join('\n'),
      'utf8'
    );
    await writeFile(
      path.join(archiveStageDir, 'profile.yaml'),
      [
        'name: imported',
        'skills: {}',
        'mcps:',
        '  github:',
        '    kind: local',
        '    source: npm',
        '    package: "@modelcontextprotocol/server-github"',
        '    env:',
        '      GITHUB_TOKEN: ${credentials.github_token}',
        '  docs:',
        '    kind: remote',
        '    transport: http',
        '    url: https://mcp.example.com',
        '    headers:',
        '      Authorization: Bearer ${credentials.optional_token}',
        'memory:',
        '  paths: []',
      ].join('\n'),
      'utf8'
    );

    const archivePath = path.join(projectDir, 'imported.tar.gz');
    execSync(`tar -czf "${archivePath}" -C "${archiveStageDir}" .`);

    const service = createProfileImportService();
    await service.execute({
      cwd: projectDir,
      archivePath,
      credentials: {
        github_token: 'ghp_live_secret',
      },
    });

    const installedProfile = YAML.parse(
      await readFile(path.join(projectDir, '.brainctl', 'profiles', 'imported', 'profile.yaml'), 'utf8')
    ) as Record<string, any>;
    expect(installedProfile.mcps.github.env.GITHUB_TOKEN).toBe('ghp_live_secret');
    expect(installedProfile.mcps.docs.headers.Authorization).toBe(
      'Bearer ${credentials.optional_token}'
    );
  });

  it('imports a bundled binary MCP without running any install command', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'brainctl-unpack-'));
    tempDirs.push(root);

    const projectDir = path.join(root, 'workspace');
    const archiveStageDir = path.join(root, 'archive-stage');
    await mkdir(projectDir, { recursive: true });
    process.env.BRAINCTL_HOME = projectDir;
    await mkdir(path.join(archiveStageDir, 'bundle', 'myserver'), { recursive: true });
    await writeFile(
      path.join(archiveStageDir, 'bundle', 'myserver', 'server'),
      '#!/bin/sh\necho hello',
      'utf8'
    );
    await writeFile(
      path.join(archiveStageDir, 'manifest.yaml'),
      [
        'schemaVersion: 1',
        'profileName: binpkg',
        'source:',
        '  kind: profile',
        '  profileName: binpkg',
      ].join('\n'),
      'utf8'
    );
    await writeFile(
      path.join(archiveStageDir, 'profile.yaml'),
      [
        'name: binpkg',
        'skills: {}',
        'mcps:',
        '  myserver:',
        '    kind: local',
        '    source: bundled',
        '    runtime: binary',
        '    path: ./bundle/myserver',
        '    command: ./server',
        'memory:',
        '  paths: []',
      ].join('\n'),
      'utf8'
    );

    const archivePath = path.join(projectDir, 'binpkg.tar.gz');
    execSync(`tar -czf "${archivePath}" -C "${archiveStageDir}" .`);

    const mockPreflightService = {
      execute: async () => ({ checks: [] }),
    };

    const service = createProfileImportService({ mcpPreflightService: mockPreflightService });
    const result = await service.execute({
      cwd: projectDir,
      archivePath,
    });

    expect(result.profileName).toBe('binpkg');
    expect(result.installedMcps).toContain('myserver');
  });

  it('imports from a folder path (no tarball extraction)', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'brainctl-unpack-folder-'));
    tempDirs.push(root);

    const projectDir = path.join(root, 'workspace');
    const folderSource = path.join(root, 'folder-profile');
    await mkdir(projectDir, { recursive: true });
    process.env.BRAINCTL_HOME = projectDir;
    await mkdir(folderSource, { recursive: true });

    await writeFile(
      path.join(folderSource, 'manifest.yaml'),
      ['schemaVersion: 1', 'profileName: folderimp'].join('\n'),
      'utf8'
    );
    await writeFile(
      path.join(folderSource, 'profile.yaml'),
      ['name: folderimp', 'skills: {}', 'mcps: {}', 'memory:', '  paths: []'].join('\n'),
      'utf8'
    );

    const service = createProfileImportService();
    const result = await service.execute({
      cwd: projectDir,
      archivePath: folderSource,
    });

    expect(result.profileName).toBe('folderimp');

    // folder source must not be deleted by import
    await expect(readFile(path.join(folderSource, 'profile.yaml'), 'utf8')).resolves.toContain(
      'folderimp'
    );

    const installedProfile = YAML.parse(
      await readFile(path.join(projectDir, '.brainctl', 'profiles', 'folderimp', 'profile.yaml'), 'utf8')
    );
    expect(installedProfile.name).toBe('folderimp');
  });

  it('does not install or persist user-skill entries owned by bundled plugins', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'brainctl-unpack-plugin-owned-'));
    tempDirs.push(root);

    const projectDir = path.join(root, 'workspace');
    const archiveStageDir = path.join(root, 'archive-stage');
    const tempHome = path.join(root, 'home');
    const originalHome = process.env.HOME;
    await mkdir(projectDir, { recursive: true });
    await mkdir(tempHome, { recursive: true });
    process.env.BRAINCTL_HOME = projectDir;
    process.env.HOME = tempHome;

    try {
      await mkdir(path.join(archiveStageDir, 'plugins', 'demo', 'skills', 'inner'), {
        recursive: true,
      });
      await mkdir(path.join(archiveStageDir, 'skills', 'inner'), { recursive: true });
      await mkdir(path.join(archiveStageDir, 'skills', 'personal'), { recursive: true });
      await writeFile(path.join(archiveStageDir, 'plugins', 'demo', 'plugin.json'), '{}', 'utf8');
      await writeFile(
        path.join(archiveStageDir, 'plugins', 'demo', 'skills', 'inner', 'SKILL.md'),
        '# plugin inner',
        'utf8'
      );
      await writeFile(path.join(archiveStageDir, 'skills', 'inner', 'SKILL.md'), '# duplicate inner', 'utf8');
      await writeFile(path.join(archiveStageDir, 'skills', 'personal', 'SKILL.md'), '# personal', 'utf8');
      await writeFile(
        path.join(archiveStageDir, 'manifest.yaml'),
        YAML.stringify({
          schemaVersion: 3,
          profileName: 'imported',
          plugins: [
            {
              agent: 'codex',
              name: 'demo',
              source: 'market',
              marketplace: 'market',
              version: '1.0.0',
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
      await writeFile(
        path.join(archiveStageDir, 'profile.yaml'),
        ['name: imported', 'mcps: {}'].join('\n'),
        'utf8'
      );

      const archivePath = path.join(projectDir, 'imported.tar.gz');
      execSync(`tar -czf "${archivePath}" -C "${archiveStageDir}" .`);

      const service = createProfileImportService();
      const result = await service.execute({ cwd: projectDir, archivePath });

      expect(result.installedPlugins).toEqual(['codex:demo']);
      expect(result.installedUserSkills).toEqual(['codex:personal']);

      const storedManifest = YAML.parse(
        await readFile(path.join(projectDir, '.brainctl', 'profiles', 'imported', 'manifest.yaml'), 'utf8')
      ) as { userSkills?: Array<{ name: string }> };
      expect(storedManifest.userSkills?.map((skill) => skill.name)).toEqual(['personal']);
    } finally {
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
    }
  });

  it('honors per-skill scope in the manifest when importing (project skills land in cwd/.claude/skills)', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'brainctl-import-proj-scope-'));
    tempDirs.push(root);

    const projectDir = path.join(root, 'workspace');
    const archiveStageDir = path.join(root, 'archive-stage');
    await mkdir(projectDir, { recursive: true });
    process.env.BRAINCTL_HOME = projectDir;

    // Build a tiny manifest+profile with one project-scoped skill.
    await mkdir(path.join(archiveStageDir, 'project-skills', 'lint'), { recursive: true });
    await writeFile(
      path.join(archiveStageDir, 'project-skills', 'lint', 'SKILL.md'),
      '---\nname: lint\n---\nrun the linter\n',
      'utf8'
    );
    await writeFile(
      path.join(archiveStageDir, 'manifest.yaml'),
      [
        'schemaVersion: 3',
        'profileName: pscope',
        'userSkills:',
        '  - agent: claude',
        '    name: lint',
        '    archivePath: project-skills/lint',
        '    scope: project',
      ].join('\n'),
      'utf8'
    );
    await writeFile(
      path.join(archiveStageDir, 'profile.yaml'),
      ['name: pscope', 'mcps: {}'].join('\n'),
      'utf8'
    );

    const archivePath = path.join(root, 'pscope.tar.gz');
    execSync(`tar -czf "${archivePath}" -C "${archiveStageDir}" .`);

    const originalHome = process.env.HOME;
    const tempHome = path.join(root, 'home');
    await mkdir(tempHome, { recursive: true });
    process.env.HOME = tempHome;

    try {
      const importService = createProfileImportService();
      const result = await importService.execute({
        cwd: projectDir,
        archivePath,
      });

      expect(result.installedUserSkills).toEqual(['claude:lint']);
      await expect(
        readFile(path.join(projectDir, '.claude', 'skills', 'lint', 'SKILL.md'), 'utf8')
      ).resolves.toContain('name: lint');
      await expect(
        readFile(path.join(tempHome, '.claude', 'skills', 'lint', 'SKILL.md'), 'utf8')
      ).rejects.toThrow();
    } finally {
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
    }
  });
});
