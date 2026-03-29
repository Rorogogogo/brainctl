import { copyFile, mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { SyncError } from '../../errors.js';
import type { McpServerConfig } from '../../types.js';
import type { AgentConfigWriter, AgentWriteOptions, AgentWriteResult } from './agent-writer.js';
import { formatTimestamp } from './agent-writer.js';

export function createGeminiWriter(): AgentConfigWriter {
  return {
    async write(options: AgentWriteOptions): Promise<AgentWriteResult> {
      const geminiDir = path.join(options.cwd, '.gemini');
      const configPath = path.join(geminiDir, 'settings.json');
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

      // Build mcpServers
      const mcpServers: Record<string, unknown> = {};

      for (const [name, config] of Object.entries(options.mcpServers)) {
        mcpServers[name] = toGeminiFormat(config);
      }

      // Always include brainctl itself
      mcpServers['brainctl'] = {
        command: 'npx',
        args: ['-y', 'brainctl', 'mcp'],
      };

      // Merge into existing config (preserve other settings)
      existing.mcpServers = mcpServers;

      // Atomic write
      await mkdir(geminiDir, { recursive: true });
      const tmpPath = `${configPath}.tmp.${Date.now()}`;
      await writeFile(tmpPath, JSON.stringify(existing, null, 2) + '\n', 'utf8');
      await rename(tmpPath, configPath);

      return { configPath, backedUpTo };
    },

    async restore(options: { cwd: string }): Promise<{ restoredFrom: string }> {
      const configPath = path.join(options.cwd, '.gemini', 'settings.json');
      const dir = path.dirname(configPath);
      const base = path.basename(configPath);

      let entries: string[];
      try {
        entries = await readdir(dir);
      } catch {
        throw new SyncError('No Gemini config directory found.');
      }

      const backups = entries
        .filter((f) => f.startsWith(`${base}.bak.`))
        .sort()
        .reverse();

      if (backups.length === 0) {
        throw new SyncError('No Gemini config backup found.');
      }

      const latestBackup = path.join(dir, backups[0]);
      await copyFile(latestBackup, configPath);
      return { restoredFrom: latestBackup };
    },
  };
}

function toGeminiFormat(config: McpServerConfig): Record<string, unknown> {
  if (config.type === 'npm') {
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
