import { execSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import YAML from 'yaml';

import { ProfileError } from '../errors.js';
import type { ProfileConfig } from '../types.js';
import { parseProfile } from './profile-service.js';

const PROFILES_DIR = '.brainctl/profiles';

export interface ProfileImportService {
  execute(options: {
    cwd?: string;
    archivePath: string;
    force?: boolean;
  }): Promise<{ profileName: string; installedMcps: string[] }>;
}

export function createProfileImportService(): ProfileImportService {
  return {
    async execute(options) {
      const cwd = options.cwd ?? process.cwd();
      const archivePath = path.resolve(cwd, options.archivePath);

      try {
        await stat(archivePath);
      } catch {
        throw new ProfileError(`Archive not found: ${archivePath}`);
      }

      const extractDir = await mkdtemp(path.join(tmpdir(), 'brainctl-import-'));

      try {
        execSync(`tar -xzf "${archivePath}" -C "${extractDir}"`, {
          stdio: 'pipe',
        });

        const profileSource = await readFile(
          path.join(extractDir, 'profile.yaml'),
          'utf8'
        );

        const profile = parseProfile(profileSource, 'imported');
        const profileName = profile.name;

        const profilePath = path.join(cwd, PROFILES_DIR, `${profileName}.yaml`);
        if (!options.force) {
          try {
            await stat(profilePath);
            throw new ProfileError(
              `Profile "${profileName}" already exists. Use --force to overwrite.`
            );
          } catch (err) {
            if (err instanceof ProfileError) throw err;
          }
        }

        const installedMcps: string[] = [];
        const mcpsBaseDir = path.join(cwd, PROFILES_DIR, profileName, 'mcps');

        for (const [name, mcp] of Object.entries(profile.mcps)) {
          if (!(mcp.kind === 'local' && mcp.source === 'bundled')) continue;

          const extractedMcpPath = path.join(extractDir, 'mcps', name);
          const destMcpPath = path.join(mcpsBaseDir, name);

          try {
            await stat(extractedMcpPath);
          } catch {
            throw new ProfileError(
              `Bundled MCP "${name}" source not found in archive.`
            );
          }

          await mkdir(destMcpPath, { recursive: true });
          await cp(extractedMcpPath, destMcpPath, { recursive: true });

          const installCmd = mcp.install ?? 'npm install';
          execSync(installCmd, {
            cwd: destMcpPath,
            stdio: 'pipe',
          });

          profile.mcps[name] = {
            ...mcp,
            path: destMcpPath,
          };

          installedMcps.push(name);
        }

        const outputYaml: Record<string, unknown> = {
          name: profile.name,
          ...(profile.description ? { description: profile.description } : {}),
          skills: profile.skills,
          mcps: profile.mcps,
          memory: profile.memory,
        };

        await mkdir(path.dirname(profilePath), { recursive: true });
        await writeFile(profilePath, YAML.stringify(outputYaml), 'utf8');

        return { profileName, installedMcps };
      } finally {
        await rm(extractDir, { recursive: true, force: true });
      }
    },
  };
}
