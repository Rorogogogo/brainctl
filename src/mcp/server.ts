import { readFileSync } from 'node:fs';
import path from 'node:path';

import { FastMCP } from 'fastmcp';
import { z } from 'zod';

import { loadConfig } from '../config.js';
import { loadMemory } from '../context/memory.js';
import { createAgentConfigService } from '../services/agent-config-service.js';
import { createDoctorService } from '../services/doctor-service.js';
import { startUiServer, type UiServer } from '../ui/server.js';
import { createMemoryWriteService } from '../services/memory-write-service.js';
import { createProfileExportService } from '../services/profile-export-service.js';
import { createProfileImportService } from '../services/profile-import-service.js';
import { createProfileService } from '../services/profile-service.js';
import { createRunService } from '../services/run-service.js';
import { createStatusService } from '../services/status-service.js';
import { createSyncService } from '../services/sync-service.js';
import type { AgentName, ProfileConfig } from '../types.js';

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

  server.addTool({
    name: 'brainctl_get_profile',
    description: 'Get the full config of a profile including all skills, MCPs, and memory paths.',
    parameters: z.object({
      name: z.string().describe('Profile name'),
    }),
    execute: async (args) => {
      const profileService = createProfileService();
      const profile = await profileService.get({ cwd, name: args.name });
      return JSON.stringify(profile, null, 2);
    },
  });

  server.addTool({
    name: 'brainctl_create_profile',
    description: 'Create a new profile with a default example skill.',
    parameters: z.object({
      name: z.string().describe('Profile name to create'),
      description: z.string().optional().describe('Profile description'),
    }),
    execute: async (args) => {
      const profileService = createProfileService();
      const result = await profileService.create({
        cwd,
        name: args.name,
        description: args.description,
      });
      return JSON.stringify(result, null, 2);
    },
  });

  server.addTool({
    name: 'brainctl_update_profile',
    description: 'Update a profile config. Pass the full profile object with skills, mcps, and memory fields. Use this to add, remove, or modify skills and MCPs within a profile.',
    parameters: z.object({
      name: z.string().describe('Profile name to update'),
      config: z.object({
        name: z.string(),
        description: z.string().optional(),
        skills: z.record(z.string(), z.object({
          description: z.string().optional(),
          prompt: z.string(),
        })),
        mcps: z.record(z.string(), z.unknown()),
        memory: z.object({
          paths: z.array(z.string()),
        }),
      }).describe('Full profile config object'),
    }),
    execute: async (args) => {
      const profileService = createProfileService();
      await profileService.update({
        cwd,
        name: args.name,
        config: args.config as ProfileConfig,
      });
      return JSON.stringify({ ok: true, updated: args.name });
    },
  });

  server.addTool({
    name: 'brainctl_delete_profile',
    description: 'Delete a profile. Cannot delete the currently active profile.',
    parameters: z.object({
      name: z.string().describe('Profile name to delete'),
    }),
    execute: async (args) => {
      const profileService = createProfileService();
      await profileService.delete({ cwd, name: args.name });
      return JSON.stringify({ ok: true, deleted: args.name });
    },
  });

  server.addTool({
    name: 'brainctl_copy_profile_items',
    description: 'Copy skills and/or MCPs from one profile to another. Specify which skill and MCP keys to copy. Existing items with the same key in the target are overwritten.',
    parameters: z.object({
      source: z.string().describe('Source profile name'),
      target: z.string().describe('Target profile name'),
      skills: z.array(z.string()).default([]).describe('Skill keys to copy'),
      mcps: z.array(z.string()).default([]).describe('MCP keys to copy'),
    }),
    execute: async (args) => {
      const profileService = createProfileService();
      const sourceProfile = await profileService.get({ cwd, name: args.source });
      const targetProfile = await profileService.get({ cwd, name: args.target });

      const copiedSkills: string[] = [];
      const copiedMcps: string[] = [];

      for (const key of args.skills) {
        if (sourceProfile.skills[key]) {
          targetProfile.skills[key] = sourceProfile.skills[key];
          copiedSkills.push(key);
        }
      }

      for (const key of args.mcps) {
        if (sourceProfile.mcps[key]) {
          targetProfile.mcps[key] = sourceProfile.mcps[key];
          copiedMcps.push(key);
        }
      }

      await profileService.update({ cwd, name: args.target, config: targetProfile });

      return JSON.stringify({
        source: args.source,
        target: args.target,
        copiedSkills,
        copiedMcps,
      }, null, 2);
    },
  });

  server.addTool({
    name: 'brainctl_export_profile',
    description: 'Export a profile as a portable tarball. Packages the profile config and bundled MCP source code for sharing.',
    parameters: z.object({
      name: z.string().optional().describe('Profile name to export'),
      agent: z.enum(['claude', 'codex', 'gemini']).optional().describe('Pack a live agent config instead of a saved profile'),
      output_path: z.string().optional().describe('Output file path (defaults to <name>.tar.gz in cwd)'),
    }),
    execute: async (args) => {
      if (!args.name && !args.agent) {
        return JSON.stringify({ error: 'Provide name or agent.' }, null, 2);
      }

      const exportService = createProfileExportService();
      const result = await exportService.execute({
        cwd,
        source: args.agent
          ? { source: 'agent', agent: args.agent, cwd }
          : { source: 'profile', name: args.name as string },
        outputPath: args.output_path,
      });
      return JSON.stringify(result, null, 2);
    },
  });

  server.addTool({
    name: 'brainctl_import_profile',
    description: 'Import a profile from a tarball. Extracts bundled MCP source, installs dependencies, and registers the profile.',
    parameters: z.object({
      archive_path: z.string().describe('Path to the profile tarball'),
      force: z.boolean().default(false).describe('Overwrite existing profile if it exists'),
      credentials: z.record(z.string(), z.string()).optional().describe('Credential values keyed by placeholder name'),
    }),
    execute: async (args) => {
      const importService = createProfileImportService();
      const result = await importService.execute({
        cwd,
        archivePath: args.archive_path,
        force: args.force,
        credentials: args.credentials,
      });
      return JSON.stringify(result, null, 2);
    },
  });

  let uiServerInstance: UiServer | null = null;

  server.addTool({
    name: 'brainctl_open_ui',
    description: 'Start the brainctl web dashboard. Returns the URL to open in a browser. If already running, returns the existing URL.',
    parameters: z.object({
      port: z.number().default(3333).describe('Port number for the UI server'),
    }),
    execute: async (args) => {
      if (uiServerInstance) {
        return JSON.stringify({ url: uiServerInstance.url, status: 'already_running' });
      }
      try {
        uiServerInstance = await startUiServer({ cwd, port: args.port });
        return JSON.stringify({ url: uiServerInstance.url, status: 'started' });
      } catch (err) {
        return JSON.stringify({ error: (err as Error).message, status: 'failed' });
      }
    },
  });

  server.addTool({
    name: 'brainctl_close_ui',
    description: 'Stop the brainctl web dashboard if it is running.',
    parameters: z.object({}),
    execute: async () => {
      if (!uiServerInstance) {
        return JSON.stringify({ status: 'not_running' });
      }
      await uiServerInstance.close();
      uiServerInstance = null;
      return JSON.stringify({ status: 'stopped' });
    },
  });

  server.addTool({
    name: 'brainctl_read_agent_configs',
    description: 'Read the live MCP configs from all agents (Claude, Codex, Gemini). Shows what is actually configured in each agent right now, by reading their real config files.',
    parameters: z.object({}),
    execute: async () => {
      const agentConfigService = createAgentConfigService();
      const configs = await agentConfigService.readAll({ cwd });
      return JSON.stringify(configs, null, 2);
    },
  });

  server.addTool({
    name: 'brainctl_add_agent_mcp',
    description: 'Add or overwrite an MCP server entry in a specific agent config. Writes directly to the agent config file (e.g., ~/.claude.json).',
    parameters: z.object({
      agent: z.enum(['claude', 'codex', 'gemini']).describe('Target agent'),
      key: z.string().describe('MCP server name/key'),
      command: z.string().describe('Command to run the MCP server'),
      args: z.array(z.string()).default([]).describe('Arguments for the command'),
    }),
    execute: async (args) => {
      const agentConfigService = createAgentConfigService();
      await agentConfigService.addMcp({
        cwd,
        agent: args.agent,
        key: args.key,
        entry: { command: args.command, args: args.args },
      });
      return JSON.stringify({ ok: true, agent: args.agent, key: args.key });
    },
  });

  server.addTool({
    name: 'brainctl_remove_agent_mcp',
    description: 'Remove an MCP server entry from a specific agent config.',
    parameters: z.object({
      agent: z.enum(['claude', 'codex', 'gemini']).describe('Target agent'),
      key: z.string().describe('MCP server name/key to remove'),
    }),
    execute: async (args) => {
      const agentConfigService = createAgentConfigService();
      await agentConfigService.removeMcp({ cwd, agent: args.agent, key: args.key });
      return JSON.stringify({ ok: true, agent: args.agent, removed: args.key });
    },
  });

  return server;
}

export async function startMcpServer(options: { cwd?: string } = {}): Promise<void> {
  const server = createMcpServer(options);
  await server.start({ transportType: 'stdio' });
}
