import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import YAML from 'yaml';

import type { BrainctlConfig } from '../types.js';

export interface ConfigWriteRequest {
  cwd?: string;
  config: BrainctlConfig;
}

export interface ConfigWriteResult {
  configPath: string;
}

export interface ConfigWriteService {
  execute(request: ConfigWriteRequest): Promise<ConfigWriteResult>;
}

export function createConfigWriteService(): ConfigWriteService {
  return {
    async execute(request: ConfigWriteRequest): Promise<ConfigWriteResult> {
      const cwd = request.cwd ?? process.cwd();
      const configPath = path.join(cwd, 'ai-stack.yaml');

      const payload = {
        memory: {
          paths: request.config.memory.paths.map((memoryPath) =>
            toRelativePath(cwd, memoryPath)
          )
        },
        skills: request.config.skills,
        mcps: request.config.mcps
      };

      await mkdir(path.dirname(configPath), { recursive: true });
      await writeFile(configPath, `${YAML.stringify(payload)}`, 'utf8');

      return { configPath };
    }
  };
}

function toRelativePath(cwd: string, filePath: string): string {
  if (path.isAbsolute(filePath)) {
    const relativePath = path.relative(cwd, filePath);
    return relativePath.length > 0 ? relativePath : '.';
  }

  return filePath;
}
