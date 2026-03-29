import { readFileSync } from 'node:fs';
import path from 'node:path';

import { FastMCP } from 'fastmcp';
import { z } from 'zod';

import { loadConfig } from '../config.js';
import { loadMemory } from '../context/memory.js';
import { createDoctorService } from '../services/doctor-service.js';
import { createMemoryWriteService } from '../services/memory-write-service.js';
import { createProfileService } from '../services/profile-service.js';
import { createRunService } from '../services/run-service.js';
import { createStatusService } from '../services/status-service.js';
import { createSyncService } from '../services/sync-service.js';
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

  server.addTool({
    name: 'brainctl_read_memory',
    description: 'Read all shared memory files. Returns every markdown file from configured memory paths with file names and content. Use this to understand context left by other agents.',
    parameters: z.object({}),
    execute: async () => {
      const config = await loadConfig({ cwd });
      const memory = await loadMemory({ paths: config.memory.paths });
      const result = {
        count: memory.count,
        files: memory.entries.map((entry) => ({
          path: entry.path,
          content: entry.content,
        })),
      };
      return JSON.stringify(result, null, 2);
    },
  });

  server.addTool({
    name: 'brainctl_write_memory',
    description: 'Write or update a shared memory file. Use this to leave notes, decisions, or context for other agents. The file must be within a configured memory path.',
    parameters: z.object({
      file_path: z.string().describe('Relative path for the memory file (e.g., "memory/notes.md")'),
      content: z.string().describe('Markdown content to write'),
    }),
    execute: async (args) => {
      const memoryWriteService = createMemoryWriteService();
      const result = await memoryWriteService.execute({
        cwd,
        filePath: args.file_path,
        content: args.content,
      });
      return JSON.stringify({ written: result.filePath });
    },
  });

  server.addTool({
    name: 'brainctl_get_skill',
    description: 'Get the full details of a specific skill including its prompt text and description. Use this to understand what a skill does before running it.',
    parameters: z.object({
      skill: z.string().describe('Skill name as defined in ai-stack.yaml'),
    }),
    execute: async (args) => {
      const config = await loadConfig({ cwd });
      const skillConfig = config.skills[args.skill];
      if (!skillConfig) {
        throw new Error(`Skill "${args.skill}" is not defined in ai-stack.yaml.`);
      }
      return JSON.stringify({
        name: args.skill,
        description: skillConfig.description ?? null,
        prompt: skillConfig.prompt,
      }, null, 2);
    },
  });

  server.addTool({
    name: 'brainctl_list_profiles',
    description: 'List available profiles and show which one is active.',
    parameters: z.object({}),
    execute: async () => {
      const profileService = createProfileService();
      const result = await profileService.list({ cwd });
      return JSON.stringify(result, null, 2);
    },
  });

  server.addTool({
    name: 'brainctl_switch_profile',
    description: 'Switch the active profile and sync it to all configured agents. Combines profile switch + sync in one step.',
    parameters: z.object({
      name: z.string().describe('Profile name to activate'),
    }),
    execute: async (args) => {
      const profileService = createProfileService();
      const switchResult = await profileService.use({ cwd, name: args.name });
      const syncService = createSyncService({ profileService });
      const syncResult = await syncService.execute({ cwd });
      return JSON.stringify({
        previousProfile: switchResult.previousProfile,
        activeProfile: args.name,
        synced: syncResult,
      }, null, 2);
    },
  });

  server.addTool({
    name: 'brainctl_sync',
    description: 'Sync the active profile to all configured agent configs (Claude, Codex). Creates backups before overwriting.',
    parameters: z.object({}),
    execute: async () => {
      const syncService = createSyncService();
      const result = await syncService.execute({ cwd });
      return JSON.stringify(result, null, 2);
    },
  });

  return server;
}

export async function startMcpServer(options: { cwd?: string } = {}): Promise<void> {
  const server = createMcpServer(options);
  await server.start({ transportType: 'stdio' });
}
