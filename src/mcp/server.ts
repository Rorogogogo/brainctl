import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { FastMCP } from 'fastmcp';
import { z } from 'zod';

import { createAgentConfigService } from '../services/agent-config-service.js';
import { createDoctorService } from '../services/doctor-service.js';
import { startUiServer, type UiServer } from '../ui/server.js';
import { createProfileExportService } from '../services/profile-export-service.js';
import { createProfileImportService } from '../services/profile-import-service.js';
import { createProfileApplyService, type ItemSelector } from '../services/profile-apply-service.js';
import { createProfileService } from '../services/profile-service.js';
import {
  createProfileSnapshotService,
  defaultBackupProfileName,
} from '../services/profile-snapshot-service.js';
import { createStatusService } from '../services/status-service.js';
import type { AgentName, ProfileConfig } from '../types.js';

const ALL_AGENTS: AgentName[] = ['claude', 'codex', 'gemini'];

const packageVersion = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
) as { version: string };

export interface UiServerState {
  current: UiServer | null;
}

export function createMcpServer(
  options: { cwd?: string; uiServerState?: UiServerState } = {}
): FastMCP {
  const cwd = options.cwd ?? process.cwd();
  const uiState: UiServerState = options.uiServerState ?? { current: null };

  const server = new FastMCP({
    name: 'brainctl',
    version: packageVersion.version as `${number}.${number}.${number}`,
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
    name: 'brainctl_apply_profile',
    description:
      'Apply a profile (MCPs, plugins, user skills) to the specified agents. Selective by --agents and --items. Auto-backs up live agent state before a full apply unless backup=false.',
    parameters: z.object({
      name: z.string().describe('Profile name to apply'),
      agents: z
        .array(z.enum(['claude', 'codex', 'gemini']))
        .optional()
        .describe('Agents to target (default: all three)'),
      items: z
        .array(
          z.object({
            type: z.enum(['mcp', 'plugin', 'skill']),
            name: z.string(),
          })
        )
        .optional()
        .describe('Specific items to apply (default: everything matching)'),
      backup: z
        .boolean()
        .optional()
        .describe('Force backup on/off (default: on for full apply, off for partial)'),
    }),
    execute: async (args) => {
      const applyService = createProfileApplyService();
      const result = await applyService.execute({
        cwd,
        profileName: args.name,
        agents: (args.agents as AgentName[] | undefined) ?? ALL_AGENTS,
        items: args.items as ItemSelector[] | undefined,
        backup: args.backup,
      });
      return JSON.stringify(result, null, 2);
    },
  });

  server.addTool({
    name: 'brainctl_snapshot_agent',
    description:
      "Snapshot a live agent's MCPs+plugins+skills into a new profile folder. Useful for backups or capturing your current setup as a shareable profile.",
    parameters: z.object({
      agent: z.enum(['claude', 'codex', 'gemini']),
      as: z
        .string()
        .optional()
        .describe('Profile name to write into (default: backup-<agent>-<timestamp>)'),
    }),
    execute: async (args) => {
      const snapshotService = createProfileSnapshotService();
      const profileName = args.as ?? defaultBackupProfileName(args.agent as AgentName);
      const result = await snapshotService.execute({
        cwd,
        agent: args.agent as AgentName,
        profileName,
      });
      return JSON.stringify({ profileName, ...result }, null, 2);
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
    description: 'Update a profile config. Pass the full profile object with name, optional description, and mcps map.',
    parameters: z.object({
      name: z.string().describe('Profile name to update'),
      config: z.object({
        name: z.string(),
        description: z.string().optional(),
        mcps: z.record(z.string(), z.unknown()),
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
    description: 'Copy MCPs from one profile to another. Existing MCPs with the same key in the target are overwritten.',
    parameters: z.object({
      source: z.string().describe('Source profile name'),
      target: z.string().describe('Target profile name'),
      mcps: z.array(z.string()).default([]).describe('MCP keys to copy'),
    }),
    execute: async (args) => {
      const profileService = createProfileService();
      const sourceProfile = await profileService.get({ cwd, name: args.source });
      const targetProfile = await profileService.get({ cwd, name: args.target });

      const copiedMcps: string[] = [];

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

  server.addTool({
    name: 'brainctl_open_ui',
    description: 'Open the brainctl web dashboard in the default browser. The dashboard auto-starts with the MCP server; this tool just opens the URL. Starts the server on demand if auto-start was skipped or failed.',
    parameters: z.object({
      port: z.number().default(3333).describe('Port to use if the dashboard needs to be started'),
      openBrowser: z
        .boolean()
        .default(true)
        .describe('Whether to launch the default browser at the UI URL'),
    }),
    execute: async (args) => {
      if (uiState.current) {
        if (args.openBrowser) openInBrowser(uiState.current.url);
        return JSON.stringify({
          url: uiState.current.url,
          status: 'already_running',
          browserOpened: args.openBrowser,
        });
      }
      try {
        uiState.current = await startUiServer({ cwd, port: args.port });
        if (args.openBrowser) openInBrowser(uiState.current.url);
        return JSON.stringify({
          url: uiState.current.url,
          status: 'started',
          browserOpened: args.openBrowser,
        });
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
      if (!uiState.current) {
        return JSON.stringify({ status: 'not_running' });
      }
      await uiState.current.close();
      uiState.current = null;
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
  const cwd = options.cwd ?? process.cwd();
  const uiServerState: UiServerState = { current: null };

  if (process.env.BRAINCTL_AUTO_UI !== '0') {
    uiServerState.current = await tryAutoStartUi(cwd, 3333);
  }

  const server = createMcpServer({ cwd, uiServerState });
  await server.start({ transportType: 'stdio' });
}

async function tryAutoStartUi(cwd: string, port: number): Promise<UiServer | null> {
  try {
    return await startUiServer({ cwd, port });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EADDRINUSE') {
      const url = `http://127.0.0.1:${port}`;
      process.stderr.write(
        `brainctl: UI port ${port} already in use; assuming another brainctl instance owns ${url}\n`
      );
      return {
        server: null as never,
        url,
        close: async () => {},
      };
    }
    process.stderr.write(`brainctl: UI auto-start failed: ${(err as Error).message}\n`);
    return null;
  }
}

function openInBrowser(url: string): void {
  const platform = process.platform;
  const { command, args } =
    platform === 'darwin'
      ? { command: 'open', args: [url] }
      : platform === 'win32'
        ? { command: 'cmd', args: ['/c', 'start', '""', url] }
        : { command: 'xdg-open', args: [url] };

  try {
    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
    });
    child.on('error', () => {
      // Browser open is best-effort; swallow errors so the MCP call still succeeds.
    });
    child.unref();
  } catch {
    // ignore
  }
}
