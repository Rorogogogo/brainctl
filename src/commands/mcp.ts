import { spawnSync } from 'node:child_process';

import type { Command } from 'commander';

import { startMcpServer } from '../mcp-server.js';
import { createUpdateCheckService } from '../services/platform/update-check-service.js';

export function registerMcpCommand(program: Command): void {
  program
    .command('mcp')
    .option('--api-base-url <url>', 'Brainctl platform API base URL')
    .description('Start the brainctl MCP server (stdio transport)')
    .action(async (options: { apiBaseUrl?: string }) => {
      killPriorMcpServers();
      await autoUpdateAndRelaunch();
      process.stdin.on('end', () => process.exit(0));
      process.stdin.on('close', () => process.exit(0));
      await startMcpServer({ cwd: process.cwd(), apiBaseUrl: options.apiBaseUrl });
      if (!process.env.BRAINCTL_NO_UPDATE_CHECK) {
        void notifyIfOutdated();
      }
    });
}

export interface AutoUpdateDeps {
  service?: ReturnType<typeof createUpdateCheckService>;
  env?: NodeJS.ProcessEnv;
  log?: (msg: string) => void;
  relaunch?: (env: NodeJS.ProcessEnv) => number;
  exit?: (code: number) => void;
}

export async function autoUpdateAndRelaunch(
  deps: AutoUpdateDeps = {}
): Promise<{ updated: boolean; reason?: string }> {
  const env = deps.env ?? process.env;
  if (env.BRAINCTL_NO_UPDATE_CHECK) return { updated: false, reason: 'disabled' };
  if (env.BRAINCTL_NO_AUTO_UPDATE) return { updated: false, reason: 'disabled' };
  // Guard against a re-launch loop if the new version still reports outdated.
  if (env.BRAINCTL_SELF_UPDATED === '1') return { updated: false, reason: 'already-updated' };

  const log = deps.log ?? ((m: string) => process.stderr.write(m));
  const relaunch =
    deps.relaunch ??
    ((nextEnv) => {
      const child = spawnSync(process.execPath, process.argv.slice(1), {
        stdio: 'inherit',
        env: nextEnv,
      });
      return child.status ?? 0;
    });
  const exit = deps.exit ?? ((code) => process.exit(code));

  const service = deps.service ?? createUpdateCheckService();
  const check = await service.check().catch(() => null);
  if (!check || !check.isOutdated) return { updated: false, reason: 'up-to-date' };

  log(`brainctl: auto-updating ${check.current} -> ${check.latest}...\n`);
  const result = await service.selfUpdate();
  if (!result.success) {
    log(
      `brainctl: self-update failed (${result.error ?? 'unknown'}); continuing on ${check.current}\n`
    );
    return { updated: false, reason: 'install-failed' };
  }

  const status = relaunch({ ...env, BRAINCTL_SELF_UPDATED: '1' });
  exit(status);
  return { updated: true };
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
