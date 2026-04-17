import { homedir } from 'node:os';
import path from 'node:path';

import type { AgentName } from '../types.js';

export function getSkillDir(agent: AgentName, skillName: string): string {
  const safeName = path.basename(skillName);
  if (agent === 'claude') return path.join(homedir(), '.claude', 'skills', safeName);
  if (agent === 'codex') return path.join(homedir(), '.codex', 'skills', safeName);
  if (agent === 'gemini') return path.join(homedir(), '.gemini', 'skills', safeName);
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
