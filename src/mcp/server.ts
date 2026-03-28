import { readFileSync } from 'node:fs';
import path from 'node:path';

import { FastMCP } from 'fastmcp';
import { z } from 'zod';

import { loadConfig } from '../config.js';
import { createDoctorService } from '../services/doctor-service.js';
import { createRunService } from '../services/run-service.js';
import { createStatusService } from '../services/status-service.js';
import type { AgentName } from '../types.js';

const packageVersion = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
) as { version: string };

export function createMcpServer(options: { cwd?: string } = {}): FastMCP {
  const cwd = options.cwd ?? process.cwd();

  const server = new FastMCP({
    name: 'brainctl',
    version: packageVersion.version as `${number}.${number}.${number}`,
  });

  server.addTool({
    name: 'brainctl_list_skills',
    description: 'List available skills from the ai-stack.yaml config',
    parameters: z.object({}),
    execute: async () => {
      const config = await loadConfig({ cwd });
      const skills = Object.entries(config.skills).map(([name, skill]) => ({
        name,
        description: skill.description ?? null,
      }));
      return JSON.stringify(skills, null, 2);
    },
  });

  server.addTool({
    name: 'brainctl_run',
    description: 'Execute a skill with input text. Runs the skill through the configured agent and returns the output.',
    parameters: z.object({
      skill: z.string().describe('Skill name as defined in ai-stack.yaml'),
      input: z.string().describe('Input text to pass to the skill'),
      agent: z.enum(['claude', 'codex']).default('claude').describe('Agent to use for execution'),
      fallback_agent: z.enum(['claude', 'codex']).optional().describe('Fallback agent if primary is unavailable'),
    }),
    execute: async (args) => {
      const inputPath = path.join(cwd, `.brainctl-mcp-input-${Date.now()}.tmp`);
      const { writeFile: writeFileAsync, unlink } = await import('node:fs/promises');

      try {
        await writeFileAsync(inputPath, args.input, 'utf8');

        const runService = createRunService();
        const trace = await runService.execute({
          cwd,
          skill: args.skill,
          inputFile: path.basename(inputPath),
          primaryAgent: args.agent as AgentName,
          fallbackAgent: args.fallback_agent as AgentName | undefined,
        });

        return trace.finalOutput;
      } finally {
        try {
          await unlink(inputPath);
        } catch {
          // temp file cleanup is best-effort
        }
      }
    },
  });

  server.addTool({
    name: 'brainctl_status',
    description: 'Show project status: config path, memory files, available skills, and agent availability',
    parameters: z.object({}),
    execute: async () => {
      const statusService = createStatusService();
      const result = await statusService.execute({ cwd });
      return JSON.stringify(result, null, 2);
    },
  });

  server.addTool({
    name: 'brainctl_doctor',
    description: 'Run health checks on the brainctl setup: config validity, memory paths, skill definitions, and agent availability',
    parameters: z.object({}),
    execute: async () => {
      const doctorService = createDoctorService();
      const result = await doctorService.execute({ cwd });
      return JSON.stringify(result, null, 2);
    },
  });

  return server;
}

export async function startMcpServer(options: { cwd?: string } = {}): Promise<void> {
  const server = createMcpServer(options);
  await server.start({ transportType: 'stdio' });
}
