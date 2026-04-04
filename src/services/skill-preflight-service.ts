import { stat } from 'node:fs/promises';

import type { AgentName } from '../types.js';
import { getSkillDir } from './skill-paths.js';

export interface SkillPreflightCheck {
  label: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
}

export interface SkillPreflightResult {
  ok: boolean;
  checks: SkillPreflightCheck[];
}

export interface SkillPreflightService {
  execute(options: {
    sourceAgent: AgentName;
    targetAgent: AgentName;
    skillName: string;
    source?: string;
  }): Promise<SkillPreflightResult>;
}

interface SkillPreflightDependencies {
  pathExists?: (targetPath: string) => Promise<boolean>;
}

export function createSkillPreflightService(
  dependencies: SkillPreflightDependencies = {}
): SkillPreflightService {
  const pathExists = dependencies.pathExists ?? defaultPathExists;

  return {
    async execute(options) {
      const checks: SkillPreflightCheck[] = [];

      if (options.source && options.source !== 'local' && options.source !== 'linked') {
        checks.push({
          label: 'Source',
          status: 'error',
          message:
            `Only local skill folders can be copied today. "${options.skillName}" is a plugin/managed entry from ${options.source}.`,
        });
        return { ok: false, checks };
      }

      const sourceDir = getSkillDir(options.sourceAgent, options.skillName);
      const exists = await pathExists(sourceDir);
      checks.push({
        label: 'Source',
        status: exists ? 'ok' : 'error',
        message: exists
          ? `Skill folder was found: ${sourceDir}`
          : `Skill folder was not found: ${sourceDir}`,
      });

      return {
        ok: exists,
        checks,
      };
    },
  };
}

async function defaultPathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}
