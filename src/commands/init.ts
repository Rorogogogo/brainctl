import pc from 'picocolors';
import type { Command } from 'commander';

import type { InitService } from '../services/init-service.js';

export function registerInitCommand(program: Command, initService: InitService): void {
  program
    .command('init')
    .description('Initialize brainctl in the current directory')
    .option('--force', 'Overwrite existing scaffolded files')
    .action(async (options: { force?: boolean }) => {
      const result = await initService.execute({
        cwd: process.cwd(),
        force: options.force
      });

      if (result.alreadyInitialized) {
        console.log('brainctl is already initialized in this directory');
        console.log('Use --force to overwrite existing files.');
        return;
      }

      for (const item of result.created) {
        console.log(pc.green(`created ${item}`));
      }

      for (const item of result.replaced) {
        console.log(pc.yellow(`replaced ${item}`));
      }

      if (result.created.length === 0 && result.replaced.length === 0) {
        console.log('No changes were required.');
      }
    });
}
