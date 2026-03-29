import pc from 'picocolors';
import type { Command } from 'commander';

import type { SyncService } from '../services/sync-service.js';

export function registerSyncCommand(program: Command, syncService: SyncService): void {
  program
    .command('sync')
    .description('Sync active profile to agent configs')
    .option('--restore', 'Restore agent configs from most recent backup')
    .action(async (options: { restore?: boolean }) => {
      const results = await syncService.execute({
        cwd: process.cwd(),
        restore: options.restore,
      });

      if (results.length === 0) {
        console.log('No agents to sync.');
        return;
      }

      if (options.restore) {
        console.log(pc.bold('Restored agent configs:'));
        for (const result of results) {
          console.log(`  ${result.agent}: restored from ${result.configPath}`);
        }
        return;
      }

      console.log(pc.bold('Synced profile to agents:'));
      for (const result of results) {
        console.log(`  ${result.agent}: ${result.configPath} (${result.mcpCount} MCPs)`);
        if (result.backedUpTo) {
          console.log(`    backed up to ${result.backedUpTo}`);
        }
      }
    });
}
