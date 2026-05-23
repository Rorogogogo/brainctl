import { homedir } from 'node:os';
import path from 'node:path';

import type { AgentName } from '../../types.js';

export type SkillScope = 'user' | 'project';

/**
 * Resolve the directory that contains a skill's `SKILL.md`.
 *
 * - `scope='user'` returns the agent's home-rooted skills dir (existing
 *   behavior).
 * - `scope='project'` returns `<cwd>/.claude/skills/<name>` and is only valid
 *   for Claude — Codex and Gemini have no project-scoped skills concept.
 */
export function getSkillDir(
  agent: AgentName,
  skillName: string,
  scope: SkillScope = 'user',
  cwd?: string
): string {
  const safeName = path.basename(skillName);
  if (scope === 'project') {
    if (agent !== 'claude') {
      throw new Error(
        `Project-scoped skills are not supported for ${agent}; only Claude reads .claude/skills/ from the workspace.`
      );
    }
    if (!cwd) {
      throw new Error('cwd is required when resolving a project-scoped skill directory.');
    }
    return path.join(cwd, '.claude', 'skills', safeName);
  }
  if (agent === 'claude') return path.join(homedir(), '.claude', 'skills', safeName);
  if (agent === 'codex') return path.join(homedir(), '.codex', 'skills', safeName);
  if (agent === 'antigravity') return path.join(homedir(), '.gemini', 'skills', safeName);
  throw new Error(`Skill management is not supported for ${agent}`);
}

export function getAgentFilePath(agent: AgentName, agentName: string): string {
  const safeName = path.basename(agentName);
  if (agent === 'claude') return path.join(homedir(), '.claude', 'agents', `${safeName}.md`);
  if (agent === 'codex') return path.join(homedir(), '.codex', 'agents', `${safeName}.toml`);
  throw new Error(`Subagent management is not supported for ${agent}`);
}

export function getCommandFilePath(agent: AgentName, commandName: string): string {
  const safeName = path.basename(commandName);
  if (agent === 'claude') return path.join(homedir(), '.claude', 'commands', `${safeName}.md`);
  throw new Error(`Slash-command management is not supported for ${agent}`);
}
