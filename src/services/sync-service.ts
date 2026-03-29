import type { AgentName, SyncAgentResult, SyncResult } from '../types.js';
import type { AgentConfigWriter } from './sync/agent-writer.js';
import { createClaudeWriter } from './sync/claude-writer.js';
import { createCodexWriter } from './sync/codex-writer.js';
import { createGeminiWriter } from './sync/gemini-writer.js';
import { createProfileService, type ProfileService } from './profile-service.js';

export interface SyncService {
  execute(options?: { cwd?: string; restore?: boolean }): Promise<SyncResult>;
}

interface SyncServiceDependencies {
  profileService?: ProfileService;
  writers?: Partial<Record<AgentName, AgentConfigWriter>>;
}

export function createSyncService(
  dependencies: SyncServiceDependencies = {}
): SyncService {
  const profileService = dependencies.profileService ?? createProfileService();

  const defaultWriters: Partial<Record<AgentName, AgentConfigWriter>> = {
    claude: createClaudeWriter(),
    codex: createCodexWriter(),
    gemini: createGeminiWriter(),
  };

  const writers = { ...defaultWriters, ...dependencies.writers };

  return {
    async execute(options = {}): Promise<SyncResult> {
      const cwd = options.cwd ?? process.cwd();

      if (options.restore) {
        return restoreAll(writers, cwd);
      }

      const meta = await profileService.getMetaConfig({ cwd });

      if (!meta.active_profile) {
        throw new Error('No active profile set. Run "brainctl profile use <name>" first.');
      }

      const profile = await profileService.get({ cwd, name: meta.active_profile });
      const results: SyncResult = [];

      for (const agent of meta.agents) {
        const writer = writers[agent];
        if (!writer) {
          continue;
        }

        const result = await writer.write({
          mcpServers: profile.mcps,
          cwd,
        });

        results.push({
          agent,
          configPath: result.configPath,
          backedUpTo: result.backedUpTo,
          mcpCount: Object.keys(profile.mcps).length + 1, // +1 for brainctl itself
        });
      }

      return results;
    },
  };
}

async function restoreAll(
  writers: Partial<Record<AgentName, AgentConfigWriter>>,
  cwd: string
): Promise<SyncResult> {
  const results: SyncResult = [];

  for (const [agent, writer] of Object.entries(writers)) {
    if (!writer) continue;

    try {
      const { restoredFrom } = await writer.restore({ cwd });
      results.push({
        agent: agent as AgentName,
        configPath: restoredFrom,
        backedUpTo: null,
        mcpCount: 0,
      });
    } catch {
      // Skip agents with no backup
    }
  }

  return results;
}
