import { execSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import YAML from 'yaml';

import { ProfileError } from '../errors.js';
import type { ProfileConfig } from '../types.js';
import { createProfileService, type ProfileService } from './profile-service.js';

export interface ProfileExportService {
  execute(options: {
    cwd?: string;
    name: string;
    outputPath?: string;
  }): Promise<{ archivePath: string }>;
}

interface ProfileExportDependencies {
  profileService?: ProfileService;
}

export function createProfileExportService(
  deps: ProfileExportDependencies = {}
): ProfileExportService {
  const profileService = deps.profileService ?? createProfileService();

  return {
    async execute(options) {
      const cwd = options.cwd ?? process.cwd();
      const profile = await profileService.get({ cwd, name: options.name });

      const stagingDir = await mkdtemp(path.join(tmpdir(), 'brainctl-export-'));

      try {
        const exportProfile = await stageProfile(profile, cwd, stagingDir);

        await writeFile(
          path.join(stagingDir, 'profile.yaml'),
          YAML.stringify(exportProfile),
          'utf8'
        );

        const outputPath =
          options.outputPath ?? path.join(cwd, `${profile.name}.tar.gz`);

        execSync(`tar -czf "${outputPath}" -C "${stagingDir}" .`, {
          stdio: 'pipe',
        });

        return { archivePath: outputPath };
      } finally {
        await rm(stagingDir, { recursive: true, force: true });
      }
    },
  };
}

async function stageProfile(
  profile: ProfileConfig,
  cwd: string,
  stagingDir: string
): Promise<Record<string, unknown>> {
  const mcpsDir = path.join(stagingDir, 'mcps');
  const exportMcps: Record<string, unknown> = {};

  for (const [name, mcp] of Object.entries(profile.mcps)) {
    if (mcp.kind === 'local' && mcp.source === 'bundled') {
      const sourcePath = path.isAbsolute(mcp.path)
        ? mcp.path
        : path.resolve(cwd, mcp.path);

      const destPath = path.join(mcpsDir, name);
      await mkdir(destPath, { recursive: true });

      await cp(sourcePath, destPath, {
        recursive: true,
        filter: (src) => !src.includes('node_modules'),
      });

      exportMcps[name] = {
        kind: 'local',
        source: 'bundled',
        path: `./mcps/${name}`,
        ...(mcp.install ? { install: mcp.install } : {}),
        command: mcp.command,
        ...(mcp.args ? { args: mcp.args } : {}),
        ...(mcp.env ? { env: mcp.env } : {}),
      };
      continue;
    }

    exportMcps[name] = mcp;
  }

  return {
    name: profile.name,
    ...(profile.description ? { description: profile.description } : {}),
    skills: profile.skills,
    mcps: exportMcps,
    memory: profile.memory,
  };
}
