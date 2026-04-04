import { copyFile, mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

import { SyncError } from '../../errors.js';
import type { McpServerConfig } from '../../types.js';
import type { AgentConfigWriter, AgentWriteOptions, AgentWriteResult } from './agent-writer.js';
import { formatTimestamp } from './agent-writer.js';

export function createClaudeWriter(): AgentConfigWriter {
  return {
    async write(options: AgentWriteOptions): Promise<AgentWriteResult> {
      const configPath = path.join(homedir(), '.claude.json');
      let existing: Record<string, unknown> = {};
      let backedUpTo: string | null = null;

      // Read existing config
      try {
        const source = await readFile(configPath, 'utf8');
        existing = JSON.parse(source) as Record<string, unknown>;
      } catch {
        // No existing config, start fresh
      }

      // Backup if file exists
      if (Object.keys(existing).length > 0) {
        const backupPath = `${configPath}.bak.${formatTimestamp()}`;
        await copyFile(configPath, backupPath);
        backedUpTo = backupPath;
      }

      // Build mcpServers for this project
      const mcpServers: Record<string, unknown> = {};

      for (const [name, config] of Object.entries(options.mcpServers)) {
        mcpServers[name] = toClaudeFormat(config);
      }

      // Always include brainctl itself
      mcpServers['brainctl'] = {
        type: 'stdio',
        command: 'npx',
        args: ['-y', 'brainctl', 'mcp'],
      };

      // Merge into existing config (preserve other projects)
      const projects = (existing.projects ?? {}) as Record<string, Record<string, unknown>>;
      const projectConfig = projects[options.cwd] ?? {};
      projectConfig.mcpServers = mcpServers;
      projects[options.cwd] = projectConfig;
      existing.projects = projects;

      // Atomic write: write to temp, then rename
      const tmpPath = `${configPath}.tmp.${Date.now()}`;
      await writeFile(tmpPath, JSON.stringify(existing, null, 2) + '\n', 'utf8');
      await rename(tmpPath, configPath);

      return { configPath, backedUpTo };
    },

    async restore(options: { cwd: string }): Promise<{ restoredFrom: string }> {
      const configPath = path.join(homedir(), '.claude.json');
      const dir = path.dirname(configPath);
      const base = path.basename(configPath);

      const entries = await readdir(dir);
      const backups = entries
        .filter((f) => f.startsWith(`${base}.bak.`))
        .sort()
        .reverse();

      if (backups.length === 0) {
        throw new SyncError('No Claude config backup found.');
      }

      const latestBackup = path.join(dir, backups[0]);
      await copyFile(latestBackup, configPath);
      return { restoredFrom: latestBackup };
    },
  };
}

function toClaudeFormat(config: McpServerConfig): Record<string, unknown> {
  if (config.kind === 'remote') {
    throw new SyncError('Remote MCP servers are not supported in Claude sync.');
  }

  if (config.source === 'npm') {
    return {
      type: 'stdio',
      command: 'npx',
      args: ['-y', config.package],
      ...(config.env ? { env: config.env } : {}),
    };
  }

  // bundled
  return {
    type: 'stdio',
    command: config.command,
    args: config.args ?? [],
    ...(config.env ? { env: config.env } : {}),
  };
}
