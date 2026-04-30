import { spawn } from 'node:child_process';
import { copyFile, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

import { ValidationError } from '../../errors.js';
import type { AgentName } from '../../types.js';
import type { AgentSkillEntry } from '../agent/agent-config-service.js';
import { formatTimestamp } from '../sync/agent-writer.js';
import { stripPluginSection } from '../sync/codex-writer.js';

export function isUnmanagedCodexPlugin(targetAgent: AgentName, plugin: AgentSkillEntry): boolean {
  return (
    !plugin.managed &&
    targetAgent === 'codex' &&
    typeof plugin.installPath === 'string' &&
    typeof plugin.source === 'string' &&
    plugin.source.length > 0
  );
}

export function isUnmanagedClaudePlugin(targetAgent: AgentName, plugin: AgentSkillEntry): boolean {
  return (
    !plugin.managed &&
    targetAgent === 'claude' &&
    typeof plugin.installPath === 'string' &&
    typeof plugin.source === 'string' &&
    plugin.source.length > 0
  );
}

export async function defaultUninstallClaudePlugin(options: {
  pluginKey: string;
  installPath: string;
}): Promise<void> {
  // Delegate to `claude plugin uninstall` so a running Claude Code session
  // drops the plugin from its in-memory state (direct fs mutation gets
  // resurrected by live sessions that still have the plugin loaded).
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      'claude',
      ['plugin', 'uninstall', options.pluginKey, '--scope', 'user'],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );

    let stderr = '';
    let stdout = '';
    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      reject(
        new ValidationError(
          `Failed to invoke \`claude\` CLI: ${error.message}. Is Claude Code installed on PATH?`
        )
      );
    });
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      const detail = (stderr || stdout).trim();
      reject(
        new ValidationError(
          `\`claude plugin uninstall ${options.pluginKey}\` exited ${code}${detail ? `: ${detail}` : ''}`
        )
      );
    });
  });
}

export async function defaultUninstallCodexPlugin(options: {
  pluginKey: string;
  installPath: string;
}): Promise<void> {
  const home = homedir();
  const cacheRoot = path.join(home, '.codex', 'plugins', 'cache');
  const resolvedInstall = path.resolve(options.installPath);

  if (!resolvedInstall.startsWith(cacheRoot + path.sep)) {
    throw new ValidationError(
      `Refusing to remove Codex plugin files outside ${cacheRoot}: ${resolvedInstall}`
    );
  }

  const pluginRoot = path.dirname(resolvedInstall);
  const configPath = path.join(home, '.codex', 'config.toml');

  let existing = '';
  try {
    existing = await readFile(configPath, 'utf8');
  } catch {
    existing = '';
  }

  if (existing.length > 0) {
    const next = stripPluginSection(existing, options.pluginKey);
    if (next !== existing) {
      const backupPath = `${configPath}.bak.${formatTimestamp()}`;
      await copyFile(configPath, backupPath);
      const tmpPath = `${configPath}.tmp.${Date.now()}`;
      await writeFile(tmpPath, next, 'utf8');
      await rename(tmpPath, configPath);
    }
  }

  await rm(pluginRoot, { recursive: true, force: true });
}
