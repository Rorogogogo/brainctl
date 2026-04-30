import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

import type { AgentName } from '../../types.js';
import type { PluginInstallCheck } from './plugin-install-service.js';

export interface IncompatibleArtifacts {
  hasAppConnector: boolean;
  hasHooks: boolean;
  hasCommands: boolean;
  codexAgentSkills: string[];
  claudeAgents: string[];
}

export async function pathExists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

export async function detectIncompatibleArtifacts(installPath: string): Promise<IncompatibleArtifacts> {
  const [hasAppConnector, hasHooks, hasCommands, codexAgentSkills, claudeAgents] = await Promise.all([
    pathExists(path.join(installPath, '.app.json')),
    pathExists(path.join(installPath, 'hooks')),
    pathExists(path.join(installPath, 'commands')),
    listCodexAgentSkills(installPath),
    listClaudeAgentFiles(installPath),
  ]);

  return { hasAppConnector, hasHooks, hasCommands, codexAgentSkills, claudeAgents };
}

async function listCodexAgentSkills(installPath: string): Promise<string[]> {
  const skillsDir = path.join(installPath, 'skills');
  try {
    const entries = await readdir(skillsDir, { withFileTypes: true });
    const matches: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      if (await pathExists(path.join(skillsDir, entry.name, 'agents'))) {
        matches.push(entry.name);
      }
    }
    return matches.sort((left, right) => left.localeCompare(right));
  } catch {
    return [];
  }
}

async function listClaudeAgentFiles(installPath: string): Promise<string[]> {
  const agentsDir = path.join(installPath, 'agents');
  try {
    const entries = await readdir(agentsDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry) => entry.name.replace(/\.md$/, ''))
      .sort((left, right) => left.localeCompare(right));
  } catch {
    return [];
  }
}

export function formatCompatibilityWarnings(
  artifacts: IncompatibleArtifacts,
  context: { sourceAgent: AgentName; targetAgent: AgentName }
): PluginInstallCheck[] {
  const warnings: PluginInstallCheck[] = [];

  if (artifacts.hasAppConnector && context.targetAgent !== 'codex') {
    warnings.push({
      label: 'App connector',
      status: 'warn',
      message: `Plugin ships a Codex app connector (.app.json) that will NOT transfer. Skill instructions will copy over but the backing integration will not work on ${context.targetAgent}.`,
    });
  }

  if (artifacts.codexAgentSkills.length > 0 && context.targetAgent !== 'codex') {
    warnings.push({
      label: 'Codex agent YAML',
      status: 'warn',
      message: `Skills ${artifacts.codexAgentSkills.join(', ')} include Codex-specific agent YAML that will not transfer to ${context.targetAgent}.`,
    });
  }

  if (artifacts.hasHooks && context.targetAgent !== 'claude') {
    warnings.push({
      label: 'Claude hooks',
      status: 'warn',
      message: `Plugin ships session hooks that only work on Claude and will NOT transfer to ${context.targetAgent}.`,
    });
  }

  if (context.targetAgent === 'gemini' && artifacts.claudeAgents.length > 0) {
    warnings.push({
      label: 'Subagents',
      status: 'warn',
      message: `Plugin ships subagent definitions (${artifacts.claudeAgents.join(', ')}) that cannot be converted to ${context.targetAgent}.`,
    });
  }

  if (context.targetAgent === 'gemini' && artifacts.hasCommands) {
    warnings.push({
      label: 'Slash commands',
      status: 'warn',
      message: `Plugin ships slash commands that cannot be converted to ${context.targetAgent}.`,
    });
  }

  return warnings;
}
