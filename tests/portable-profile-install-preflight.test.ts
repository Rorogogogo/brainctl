import { execSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ProfileError } from '../src/errors.js';
import { createProfileImportService } from '../src/services/profile-import-service.js';

describe('portable profile install preflight', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
    );
  });

  it('surfaces bundled MCP install failures with a useful error', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'brainctl-install-preflight-'));
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
        '    install: node -e "process.exit(2)"',
        '    command: node',
        'memory:',
        '  paths: []',
      ].join('\n'),
      'utf8'
    );

    const archivePath = path.join(projectDir, 'imported.tar.gz');
    execSync(`tar -czf "${archivePath}" -C "${archiveStageDir}" .`);

    await expect(
      createProfileImportService().execute({
        cwd: projectDir,
        archivePath,
      })
    ).rejects.toThrowError(
      new ProfileError('Bundled MCP "demo" install failed: Command failed: node -e "process.exit(2)"')
    );
  });

  it('fails import when a bundled MCP does not pass post-install preflight', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'brainctl-install-preflight-'));
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
        '    install: node -e "process.exit(0)"',
        '    command: node',
        '    args:',
        '      - ./dist/index.js',
        'memory:',
        '  paths: []',
      ].join('\n'),
      'utf8'
    );

    const archivePath = path.join(projectDir, 'imported.tar.gz');
    execSync(`tar -czf "${archivePath}" -C "${archiveStageDir}" .`);

    await expect(
      createProfileImportService().execute({
        cwd: projectDir,
        archivePath,
      })
    ).rejects.toThrowError(
      new ProfileError(
        `Imported MCP "demo" failed validation: Entrypoint script was not found: ${path.join(
          projectDir,
          '.brainctl',
          'profiles',
          'imported',
          'mcps',
          'demo',
          'dist',
          'index.js'
        )}`
      )
    );
  });

  it('rejects imported remote MCPs with non-http absolute urls without attempting local install', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'brainctl-install-preflight-'));
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
        '  docs:',
        '    kind: remote',
        '    transport: http',
        '    url: ftp://mcp.example.com',
        'memory:',
        '  paths: []',
      ].join('\n'),
      'utf8'
    );

    const archivePath = path.join(projectDir, 'imported.tar.gz');
    execSync(`tar -czf "${archivePath}" -C "${archiveStageDir}" .`);

    await expect(
      createProfileImportService().execute({
        cwd: projectDir,
        archivePath,
      })
    ).rejects.toThrowError(
      new ProfileError('Remote MCP "docs" must include an absolute http(s) url.')
    );
  });
});
