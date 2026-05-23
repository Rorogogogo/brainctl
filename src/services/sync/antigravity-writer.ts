import { copyFile, mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

import { SyncError } from '../../errors.js';
import type { McpServerConfig } from '../../types.js';
import type { AgentConfigWriter, AgentWriteOptions, AgentWriteResult } from './agent-writer.js';
import { formatTimestamp } from './agent-writer.js';

export function createAntigravityWriter(): AgentConfigWriter {
  return {
    async write(options: AgentWriteOptions): Promise<AgentWriteResult> {
      void options.cwd;
      const geminiDir = path.join(homedir(), '.gemini', 'antigravity-cli');
      const configPath = path.join(geminiDir, 'mcp_config.json');
      let existing: Record<string, unknown> = {};
      let backedUpTo: string | null = null;

      // Read existing config
      try {
        const source = await readFile(configPath, 'utf8');
        existing = JSON.parse(source) as Record<string, unknown>;
      } catch {
        // No existing config, start fresh
      }

      // Backup if file exists with content
      if (Object.keys(existing).length > 0) {
        const backupPath = `${configPath}.bak.${formatTimestamp()}`;
        await copyFile(configPath, backupPath);
        backedUpTo = backupPath;
      }

      const baselineMcpServers =
        options.merge && existing.mcpServers && typeof existing.mcpServers === 'object'
          ? { ...(existing.mcpServers as Record<string, unknown>) }
          : {};

      for (const [name, config] of Object.entries(options.mcpServers)) {
        baselineMcpServers[name] = toAntigravityFormat(config);
      }

      existing.mcpServers = baselineMcpServers;

      // Atomic write
      await mkdir(geminiDir, { recursive: true });
      const tmpPath = `${configPath}.tmp.${Date.now()}`;
      await writeFile(tmpPath, JSON.stringify(existing, null, 2) + '\n', 'utf8');
      await rename(tmpPath, configPath);

      return { configPath, backedUpTo };
    },

    async restore(options: { cwd: string }): Promise<{ restoredFrom: string }> {
      void options.cwd;
      const configPath = path.join(homedir(), '.gemini', 'antigravity-cli', 'mcp_config.json');
      const dir = path.dirname(configPath);
      const base = path.basename(configPath);

      let entries: string[];
      try {
        entries = await readdir(dir);
      } catch {
        throw new SyncError('No Antigravity config directory found.');
      }

      const backups = entries
         .filter((f) => f.startsWith(`${base}.bak.`))
         .sort()
         .reverse();

      if (backups.length === 0) {
        throw new SyncError('No Antigravity config backup found.');
      }

      const latestBackup = path.join(dir, backups[0]);
      await copyFile(latestBackup, configPath);
      return { restoredFrom: latestBackup };
    },
  };
}

function toAntigravityFormat(config: McpServerConfig): Record<string, unknown> {
  if (config.kind === 'remote') {
    throw new SyncError('Remote MCP servers are not supported in Antigravity sync.');
  }

  if (config.source === 'npm') {
    return {
      command: 'npx',
      args: ['-y', config.package],
      ...(config.env ? { env: config.env } : {}),
    };
  }

  // bundled
  return {
    command: config.command,
    args: config.args ?? [],
    ...(config.env ? { env: config.env } : {}),
  };
}
