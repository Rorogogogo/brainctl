import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { AgentName } from '../../types.js';
import {
  claudeAgentMdToCodexToml,
  claudeCommandMdToCodexSkill,
  codexAgentTomlToClaudeMd,
} from '../agent/agent-converter-service.js';
import { getAgentFilePath, getCommandFilePath, getSkillDir } from './skill-paths.js';
import type { PluginBundleAgent, PluginBundleCommand } from './plugin-install-bundle.js';

export async function defaultInstallAgent(options: {
  targetAgent: AgentName;
  agent: PluginBundleAgent;
}): Promise<void> {
  const targetPath = getAgentFilePath(options.targetAgent, options.agent.name);
  await mkdir(path.dirname(targetPath), { recursive: true });

  let output: string;
  if (options.targetAgent === 'claude') {
    output = options.agent.sourceFormat === 'claude-md'
      ? options.agent.content
      : codexAgentTomlToClaudeMd(options.agent.content);
  } else if (options.targetAgent === 'codex') {
    output = options.agent.sourceFormat === 'codex-toml'
      ? options.agent.content
      : claudeAgentMdToCodexToml(options.agent.content);
  } else {
    throw new Error(`Agent install is not supported for ${options.targetAgent}`);
  }

  await writeFile(targetPath, output, 'utf8');
}

export async function defaultInstallCommand(options: {
  targetAgent: AgentName;
  command: PluginBundleCommand;
}): Promise<void> {
  if (options.targetAgent === 'claude') {
    const targetPath = getCommandFilePath('claude', options.command.name);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, options.command.content, 'utf8');
    return;
  }
  if (options.targetAgent === 'codex') {
    const skillDir = getSkillDir('codex', options.command.name);
    await mkdir(skillDir, { recursive: true });
    const { skillMarkdown } = claudeCommandMdToCodexSkill(options.command.content);
    await writeFile(path.join(skillDir, 'SKILL.md'), skillMarkdown, 'utf8');
    return;
  }
  throw new Error(`Command install is not supported for ${options.targetAgent}`);
}

export async function defaultRemoveAgentFile(options: {
  targetAgent: AgentName;
  agentName: string;
}): Promise<void> {
  const targetPath = getAgentFilePath(options.targetAgent, options.agentName);
  await rm(targetPath, { force: true });
}

export async function defaultRemoveCommandFile(options: {
  targetAgent: AgentName;
  commandName: string;
}): Promise<void> {
  if (options.targetAgent === 'claude') {
    const targetPath = getCommandFilePath('claude', options.commandName);
    await rm(targetPath, { force: true });
    return;
  }
  if (options.targetAgent === 'codex') {
    const skillDir = getSkillDir('codex', options.commandName);
    await rm(skillDir, { recursive: true, force: true });
    return;
  }
}

export async function defaultCopySkillDirectory(options: {
  sourceInstallPath: string;
  skillName: string;
  targetAgent: AgentName;
}): Promise<void> {
  const sourceDir = path.join(options.sourceInstallPath, 'skills', options.skillName);
  const targetDir = getSkillDir(options.targetAgent, options.skillName);
  await mkdir(path.dirname(targetDir), { recursive: true });
  await cp(sourceDir, targetDir, { recursive: true });
}

export async function defaultRemoveSkillDirectory(options: {
  targetAgent: AgentName;
  skillName: string;
}): Promise<void> {
  const targetDir = getSkillDir(options.targetAgent, options.skillName);
  await rm(targetDir, { recursive: true, force: true });
}
