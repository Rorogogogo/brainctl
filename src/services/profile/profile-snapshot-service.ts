import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import YAML from 'yaml';

import { profileDir } from './profile-service.js';
import { createPortableProfilePackService } from './portable-profile-pack-service.js';
import type { AgentName } from '../../types.js';

export interface ProfileSnapshotService {
  execute(options: {
    cwd: string;
    agent: AgentName;
    profileName: string;
    onProgress?: (message: string) => void;
  }): Promise<{ profilePath: string }>;
}

export function createProfileSnapshotService(): ProfileSnapshotService {
  const packService = createPortableProfilePackService();

  return {
    async execute(options) {
      const outputPath = profileDir(options.cwd, options.profileName);
      const result = await packService.execute({
        cwd: options.cwd,
        source: { source: 'agent', agent: options.agent, cwd: options.cwd },
        outputPath,
        format: 'folder',
        credentialsMode: 'keep',
        onProgress: options.onProgress,
      });
      options.onProgress?.(`Naming profile "${options.profileName}"…`);
      await renameInsideProfile(outputPath, options.profileName);
      return { profilePath: result.archivePath };
    },
  };
}

async function renameInsideProfile(profilePath: string, name: string): Promise<void> {
  const profileFile = path.join(profilePath, 'profile.yaml');
  const manifestFile = path.join(profilePath, 'manifest.yaml');
  for (const file of [profileFile, manifestFile]) {
    try {
      const source = await readFile(file, 'utf8');
      const parsed = YAML.parse(source) as Record<string, unknown>;
      if (file === profileFile) parsed.name = name;
      else parsed.profileName = name;
      await writeFile(file, YAML.stringify(parsed), 'utf8');
    } catch {
      // best-effort
    }
  }
}

export function defaultBackupProfileName(agent: AgentName): string {
  const ts = new Date()
    .toISOString()
    .replace(/[-:T]/g, '')
    .replace(/\..+$/, '');
  return `backup-${agent}-${ts}`;
}
