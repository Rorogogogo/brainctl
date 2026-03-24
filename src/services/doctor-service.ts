import { stat } from 'node:fs/promises';
import path from 'node:path';

import { loadConfig } from '../config.js';
import { createExecutorResolver } from '../executor/resolver.js';
import type { ExecutorResolver } from '../executor/resolver.js';
import type { DiagnosticCheck } from '../types.js';

export interface DoctorResult {
  checks: DiagnosticCheck[];
  hasIssues: boolean;
}

export interface DoctorService {
  execute(options?: { cwd?: string }): Promise<DoctorResult>;
}

export function createDoctorService(
  dependencies: { resolver?: ExecutorResolver } = {}
): DoctorService {
  const resolver = dependencies.resolver ?? createExecutorResolver();

  return {
    async execute(options = {}): Promise<DoctorResult> {
      const cwd = options.cwd ?? process.cwd();
      const checks: DiagnosticCheck[] = [];
      const configPath = path.join(cwd, 'ai-stack.yaml');

      const configExists = await pathExists(configPath);
      if (!configExists) {
        checks.push({
          label: 'Config',
          status: 'error',
          message: 'ai-stack.yaml was not found.'
        });
      }

      if (configExists) {
        try {
          const config = await loadConfig({ cwd });

          checks.push({
            label: 'Config',
            status: 'ok',
            message: `Loaded ${config.configPath}`
          });

          for (const memoryPath of config.memory.paths) {
            const exists = await pathExists(memoryPath);
            checks.push({
              label: 'Memory',
              status: exists ? 'ok' : 'error',
              message: exists
                ? `Memory path is available: ${memoryPath}`
                : `Memory path is missing: ${memoryPath}`
            });
          }

          checks.push({
            label: 'Skills',
            status: Object.keys(config.skills).length > 0 ? 'ok' : 'error',
            message:
              Object.keys(config.skills).length > 0
                ? `${Object.keys(config.skills).length} skills configured`
                : 'No skills are configured.'
          });
        } catch (error) {
          checks.push({
            label: 'Config',
            status: 'error',
            message: error instanceof Error ? error.message : 'Config validation failed.'
          });
        }
      }

      const availability = await resolver.getAgentAvailability();
      for (const agent of Object.values(availability)) {
        checks.push({
          label: 'Agent',
          status: agent.available ? 'ok' : 'warn',
          message: agent.available
            ? `${agent.agent} is available`
            : `${agent.agent} is not available on PATH`
        });
      }

      return {
        checks,
        hasIssues: checks.some((check) => check.status !== 'ok')
      };
    }
  };
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}
