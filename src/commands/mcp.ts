import { spawn } from 'node:child_process';

import type { Command } from 'commander';

import { startMcpServer } from '../mcp-server.js';
import { createUpdateCheckService } from '../services/platform/update-check-service.js';

export function registerMcpCommand(program: Command): void {
  program
    .command('mcp')
    .description('Start the brainctl MCP server (stdio transport)')
    .action(async () => {
      if (!process.env.BRAINCTL_NO_UPDATE_CHECK) {
        await autoUpdateIfNeeded();
      }
      await startMcpServer({ cwd: process.cwd() });
    });
}

async function autoUpdateIfNeeded(): Promise<void> {
  try {
    const service = createUpdateCheckService();
    const check = await service.check();

    if (!check.isOutdated) return;

    const result = await service.selfUpdate();

    if (result.success) {
      // Re-exec with the updated binary
      const child = spawn(process.execPath, process.argv.slice(1), {
        stdio: 'inherit',
      });
      await new Promise<void>((resolve) => {
        child.on('exit', (code) => {
          process.exit(code ?? 0);
        });
        child.on('error', () => {
          resolve(); // fall through to current version
        });
      });
      return;
    }

    if (result.error) {
      process.stderr.write(`brainctl: auto-update failed: ${result.error}\n`);
    }
  } catch {
    // Update check failed entirely — continue silently
  }
}
