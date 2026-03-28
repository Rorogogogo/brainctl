import type { Command } from 'commander';

import { startMcpServer } from '../mcp/server.js';

export function registerMcpCommand(program: Command): void {
  program
    .command('mcp')
    .description('Start the brainctl MCP server (stdio transport)')
    .action(async () => {
      await startMcpServer({ cwd: process.cwd() });
    });
}
