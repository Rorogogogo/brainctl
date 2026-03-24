import pc from 'picocolors';
import type { Command } from 'commander';

import type { StatusService } from '../services/status-service.js';

export function registerStatusCommand(program: Command, statusService: StatusService): void {
  program
    .command('status')
    .description('Show current brainctl configuration status')
    .action(async () => {
      const status = await statusService.execute({ cwd: process.cwd() });

      console.log(pc.bold('brainctl status'));
      console.log(`Config: ${status.configPath}`);
      console.log(`Memory files loaded: ${status.memory.count}`);
      console.log(
        `Available skills: ${status.skills.length > 0 ? status.skills.join(', ') : 'none'}`
      );
      console.log(`MCP count: ${status.mcpCount}`);
      console.log('Available agents:');

      for (const agent of Object.values(status.agents)) {
        console.log(
          `- ${agent.agent}: ${agent.available ? pc.green('available') : pc.yellow('missing')}`
        );
      }
    });
}
