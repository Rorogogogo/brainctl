import type { Command } from 'commander';

import { startUiServer } from '../ui/server.js';

export function registerUiCommand(program: Command): void {
  program
    .command('ui')
    .description('Start the local brainctl dashboard')
    .action(async () => {
      const server = await startUiServer({ cwd: process.cwd() });
      console.log(`brainctl UI listening at ${server.url}`);
    });
}
