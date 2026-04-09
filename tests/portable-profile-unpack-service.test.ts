import { execSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import YAML from 'yaml';
import { afterEach, describe, expect, it } from 'vitest';

import { ProfileError } from '../src/errors.js';
import { createProfileImportService } from '../src/services/profile-import-service.js';

describe('createProfileImportService portable unpack', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
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
    });

    const installedProfile = YAML.parse(
      await readFile(path.join(projectDir, '.brainctl', 'profiles', 'imported.yaml'), 'utf8')
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
    await mkdir(archiveStageDir, { recursive: true });
    await writeFile(
      path.join(archiveStageDir, 'manifest.yaml'),
      ['schemaVersion: 2', 'profileName: unsupported'].join('\n'),
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
      new ProfileError('Unsupported portable profile schema version: 2.')
    );
  });

  it('rejects bundled MCP paths that escape the extracted archive root', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'brainctl-unpack-'));
    tempDirs.push(root);

    const projectDir = path.join(root, 'workspace');
    const archiveStageDir = path.join(root, 'archive-stage');
    await mkdir(projectDir, { recursive: true });
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

  it('rejects imports with missing required credential placeholders', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'brainctl-unpack-'));
    tempDirs.push(root);

    const projectDir = path.join(root, 'workspace');
    const archiveStageDir = path.join(root, 'archive-stage');
    await mkdir(projectDir, { recursive: true });
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

    await expect(
      service.execute({
        cwd: projectDir,
        archivePath,
      })
    ).rejects.toThrowError(
      new ProfileError('Missing required credentials: db_password.')
    );
  });

  it('resolves supplied credentials before persisting the imported profile and leaves optional placeholders intact', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'brainctl-unpack-'));
    tempDirs.push(root);

    const projectDir = path.join(root, 'workspace');
    const archiveStageDir = path.join(root, 'archive-stage');
    await mkdir(projectDir, { recursive: true });
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
      await readFile(path.join(projectDir, '.brainctl', 'profiles', 'imported.yaml'), 'utf8')
    ) as Record<string, any>;
    expect(installedProfile.mcps.github.env.GITHUB_TOKEN).toBe('ghp_live_secret');
    expect(installedProfile.mcps.docs.headers.Authorization).toBe(
      'Bearer ${credentials.optional_token}'
    );
  });
});
