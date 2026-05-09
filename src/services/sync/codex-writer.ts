import { copyFile, mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

import { SyncError } from '../../errors.js';
import type { McpServerConfig } from '../../types.js';
import type { AgentConfigWriter, AgentWriteOptions, AgentWriteResult } from './agent-writer.js';
import { formatTimestamp } from './agent-writer.js';

export function createCodexWriter(): AgentConfigWriter {
  return {
    async write(options: AgentWriteOptions): Promise<AgentWriteResult> {
      const configDir = path.join(homedir(), '.codex');
      const configPath = path.join(configDir, 'config.toml');
      let existingContent = '';
      let backedUpTo: string | null = null;

      // Read existing config
      try {
        existingContent = await readFile(configPath, 'utf8');
      } catch {
        // No existing config
      }

      // Backup if file exists
      if (existingContent.length > 0) {
        const backupPath = `${configPath}.bak.${formatTimestamp()}`;
        await copyFile(configPath, backupPath);
        backedUpTo = backupPath;
      }

      // Build MCP servers section
      const mcpToml = buildMcpToml(options.mcpServers);

      // In merge mode, preserve existing [mcp_servers.*] entries except those
      // being overridden by the new MCPs. In replace mode, strip all of them.
      const baselineContent = options.merge
        ? Object.keys(options.mcpServers).reduce(
            (acc, key) => stripMcpSection(acc, key),
            existingContent
          )
        : stripMcpSections(existingContent);

      const finalContent = baselineContent.trim().length > 0
        ? `${baselineContent.trim()}\n\n${mcpToml}`
        : mcpToml;

      // Atomic write
      await mkdir(configDir, { recursive: true });
      const tmpPath = `${configPath}.tmp.${Date.now()}`;
      await writeFile(tmpPath, finalContent + '\n', 'utf8');
      await rename(tmpPath, configPath);

      return { configPath, backedUpTo };
    },

    async restore(options: { cwd: string }): Promise<{ restoredFrom: string }> {
      const configPath = path.join(homedir(), '.codex', 'config.toml');
      const dir = path.dirname(configPath);
      const base = path.basename(configPath);

      let entries: string[];
      try {
        entries = await readdir(dir);
      } catch {
        throw new SyncError('No Codex config directory found.');
      }

      const backups = entries
        .filter((f) => f.startsWith(`${base}.bak.`))
        .sort()
        .reverse();

      if (backups.length === 0) {
        throw new SyncError('No Codex config backup found.');
      }

      const latestBackup = path.join(dir, backups[0]);
      await copyFile(latestBackup, configPath);
      return { restoredFrom: latestBackup };
    },
  };
}

function buildMcpToml(servers: Record<string, McpServerConfig>): string {
  const lines: string[] = [];

  for (const [name, config] of Object.entries(servers)) {
    lines.push(`[mcp_servers.${name}]`);

    if (config.kind === 'remote') {
      throw new SyncError('Remote MCP servers are not supported in Codex sync.');
    }

    if (config.source === 'npm') {
      lines.push(`command = "npx"`);
      lines.push(`args = ["-y", ${tomlString(config.package)}]`);
    } else {
      lines.push(`command = ${tomlString(config.command)}`);
      if (config.args && config.args.length > 0) {
        const argsStr = config.args.map(tomlString).join(', ');
        lines.push(`args = [${argsStr}]`);
      }
    }

    if (config.env && Object.keys(config.env).length > 0) {
      lines.push('');
      lines.push(`[mcp_servers.${name}.env]`);
      for (const [key, value] of Object.entries(config.env)) {
        lines.push(`${key} = ${tomlString(value)}`);
      }
    }

    lines.push('');
  }

  return lines.join('\n').trim();
}

function tomlString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function stripPluginSection(content: string, pluginKey: string): string {
  const target = `[plugins."${pluginKey}"]`;
  const lines = content.split('\n');
  const result: string[] = [];
  let inTarget = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === target) {
      inTarget = true;
      continue;
    }

    if (inTarget && /^\[/.test(trimmed)) {
      inTarget = false;
    }

    if (!inTarget) {
      result.push(line);
    }
  }

  return result.join('\n');
}

function stripMcpSection(content: string, mcpKey: string): string {
  const headerPattern = new RegExp(`^\\[mcp_servers\\.${mcpKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\.[^\\]]+)?\\]$`);
  const lines = content.split('\n');
  const result: string[] = [];
  let inTarget = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (headerPattern.test(trimmed)) {
      inTarget = true;
      continue;
    }
    if (inTarget && /^\[/.test(trimmed)) {
      inTarget = false;
    }
    if (!inTarget) {
      result.push(line);
    }
  }

  return result.join('\n');
}

function stripMcpSections(content: string): string {
  const lines = content.split('\n');
  const result: string[] = [];
  let inMcpSection = false;

  for (const line of lines) {
    if (/^\[mcp_servers[\].]/.test(line)) {
      inMcpSection = true;
      continue;
    }

    if (inMcpSection && /^\[/.test(line) && !/^\[mcp_servers[\].]/.test(line)) {
      inMcpSection = false;
    }

    if (!inMcpSection) {
      result.push(line);
    }
  }

  return result.join('\n');
}
