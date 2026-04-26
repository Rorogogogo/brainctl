import pc from 'picocolors';
import type { Command } from 'commander';

import type { StatusService } from '../services/status-service.js';

export function registerStatusCommand(program: Command, statusService: StatusService): void {
  program
    .command('status')
    .description('Show agent availability and profile inventory')
    .action(async () => {
      const status = await statusService.execute({ cwd: process.cwd() });

      console.log(pc.bold('brainctl status'));
      console.log(`Profiles: ${status.profiles.count}`);
      for (const name of status.profiles.names) {
        console.log(`  ${name}`);
      }
      console.log('Agents:');
      for (const agent of Object.values(status.agents)) {
        console.log(
          `  ${agent.agent}: ${agent.available ? pc.green('available') : pc.yellow('missing')}`
        );
      }
    });
}
