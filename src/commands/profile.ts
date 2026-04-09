import pc from 'picocolors';
import type { Command } from 'commander';

import type { ProfileExportService } from '../services/profile-export-service.js';
import type { ProfileImportService } from '../services/profile-import-service.js';
import type { ProfileService } from '../services/profile-service.js';

export interface ProfileCommandServices {
  profileService: ProfileService;
  profileExportService: ProfileExportService;
  profileImportService: ProfileImportService;
}

export function registerProfileCommand(program: Command, services: ProfileCommandServices): void {
  const { profileService, profileExportService, profileImportService } = services;
  const profileCmd = program
    .command('profile')
    .description('Manage brainctl profiles');

  profileCmd
    .command('list')
    .description('List available profiles')
    .action(async () => {
      const { profiles, activeProfile } = await profileService.list({ cwd: process.cwd() });

      if (profiles.length === 0) {
        console.log('No profiles found. Run "brainctl profile create <name>" to create one.');
        return;
      }

      console.log(pc.bold('Profiles:'));
      for (const name of profiles) {
        const marker = name === activeProfile ? pc.green(' (active)') : '';
        console.log(`  ${name}${marker}`);
      }
    });

  profileCmd
    .command('create')
    .argument('<name>', 'Profile name')
    .option('-d, --description <text>', 'Profile description')
    .description('Create a new profile')
    .action(async (name: string, options: { description?: string }) => {
      const result = await profileService.create({
        cwd: process.cwd(),
        name,
        description: options.description,
      });
      console.log(`Created profile at ${result.profilePath}`);
    });

  profileCmd
    .command('use')
    .argument('<name>', 'Profile name to activate')
    .description('Switch the active profile')
    .action(async (name: string) => {
      const result = await profileService.use({ cwd: process.cwd(), name });
      const prev = result.previousProfile ? ` (was "${result.previousProfile}")` : '';
      console.log(`Switched to profile "${name}"${prev}`);
    });

  profileCmd
    .command('export')
    .argument('[name]', 'Profile name to export')
    .option('-a, --agent <name>', 'Pack a live agent config instead (claude, codex, gemini)')
    .option('-o, --output <path>', 'Output file path')
    .description('Export a profile as a portable tarball')
    .action(async (name: string | undefined, options: { agent?: string; output?: string }) => {
      const agent =
        options.agent === 'claude' || options.agent === 'codex' || options.agent === 'gemini'
          ? options.agent
          : undefined;
      if (!agent && !name) {
        throw new Error('Provide a profile name or --agent <name>.');
      }

      const result = await profileExportService.execute({
        cwd: process.cwd(),
        source: agent
          ? { source: 'agent', agent, cwd: process.cwd() }
          : { source: 'profile', name: name as string },
        outputPath: options.output,
      });
      console.log(`Exported profile to ${result.archivePath}`);
    });

  profileCmd
    .command('import')
    .argument('<archive>', 'Path to profile tarball')
    .option('--force', 'Overwrite existing profile', false)
    .option('-c, --credential <key=value>', 'Provide a credential value for import', collectCredentialOption, [])
    .description('Import a profile from a tarball')
    .action(async (archive: string, options: { force: boolean; credential: string[] }) => {
      const result = await profileImportService.execute({
        cwd: process.cwd(),
        archivePath: archive,
        force: options.force,
        credentials: toCredentialMap(options.credential),
      });

      console.log(`Imported profile "${result.profileName}"`);
      if (result.installedMcps.length > 0) {
        console.log(`Installed bundled MCPs: ${result.installedMcps.join(', ')}`);
      }
    });
}

function collectCredentialOption(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function toCredentialMap(values: string[]): Record<string, string> | undefined {
  if (values.length === 0) {
    return undefined;
  }

  const credentials: Record<string, string> = {};
  for (const value of values) {
    const separatorIndex = value.indexOf('=');
    if (separatorIndex <= 0 || separatorIndex === value.length - 1) {
      throw new Error(`Invalid credential "${value}". Use key=value.`);
    }

    const key = value.slice(0, separatorIndex).trim();
    const credentialValue = value.slice(separatorIndex + 1).trim();
    if (!key || !credentialValue) {
      throw new Error(`Invalid credential "${value}". Use key=value.`);
    }

    credentials[key] = credentialValue;
  }

  return credentials;
}
