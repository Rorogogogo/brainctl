import pc from 'picocolors';
import type { Command } from 'commander';

import type { ProfileService } from '../services/profile-service.js';

export function registerProfileCommand(program: Command, profileService: ProfileService): void {
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
}
