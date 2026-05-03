import { spawnSync } from 'node:child_process';

import type { Command } from 'commander';

import { startMcpServer } from '../mcp-server.js';
import { createUpdateCheckService } from '../services/platform/update-check-service.js';

export function registerMcpCommand(program: Command): void {
  program
    .command('mcp')
    .description('Start the brainctl MCP server (stdio transport)')
    .action(async () => {
      killPriorMcpServers();
      process.stdin.on('end', () => process.exit(0));
      process.stdin.on('close', () => process.exit(0));
      await startMcpServer({ cwd: process.cwd() });
      if (!process.env.BRAINCTL_NO_UPDATE_CHECK) {
        // Fire-and-forget after the server is up so cold-start isn't blocked
        // on a network round-trip (or `npm install brainctl@latest`).
        void notifyIfOutdated();
      }
    });
}

function killPriorMcpServers(): void {
  const self = process.pid;
  const ppid = process.ppid;
  try {
    const result = spawnSync('pgrep', ['-f', 'brainctl/dist/cli\\.js mcp'], {
      encoding: 'utf8',
    });
    if (result.status !== 0 || !result.stdout) return;
    const pids = result.stdout
      .split('\n')
      .map((line) => Number.parseInt(line.trim(), 10))
      .filter((pid) => Number.isFinite(pid) && pid !== self && pid !== ppid);
    for (const pid of pids) {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        // already gone
      }
    }
  } catch {
    // pgrep unavailable — skip
  }
}

async function notifyIfOutdated(): Promise<void> {
  try {
    const service = createUpdateCheckService();
    const check = await service.check();
    if (check.isOutdated) {
      process.stderr.write(
        `brainctl: a newer version is available (${check.latest}). Run \`npm i -g brainctl@latest\` to update.\n`
      );
    }
  } catch {
    // Update check failed — stay silent
  }
}
