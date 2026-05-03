import { readFile } from 'node:fs/promises';
import path from 'node:path';

import YAML from 'yaml';

import { ProfileError } from '../../errors.js';
import type {
  AgentName,
  PortableProfileManifest,
  PortableUserSkillSnapshot,
  SyncResult,
} from '../../types.js';
import { installPlugin, installUserSkill } from '../agent/agent-asset-installer.js';
import {
  createProfileSnapshotService,
  defaultBackupProfileName,
  type ProfileSnapshotService,
} from './profile-snapshot-service.js';
import { createProfileService, profileDir, type ProfileService } from './profile-service.js';
import type { AgentConfigWriter } from '../sync/agent-writer.js';
import { createClaudeWriter } from '../sync/claude-writer.js';
import { createCodexWriter } from '../sync/codex-writer.js';
import { createGeminiWriter } from '../sync/gemini-writer.js';

export type ItemType = 'mcp' | 'plugin' | 'skill';

export interface ItemSelector {
  type: ItemType;
  name: string;
}

export interface ApplyOptions {
  cwd?: string;
  profileName: string;
  agents: AgentName[];
  items?: ItemSelector[]; // undefined = everything matching
  backup?: boolean; // default true for full apply, false for partial
}

export interface ApplyResult extends SyncResult {}

export interface ProfileApplyService {
  execute(options: ApplyOptions): Promise<{
    backups: Array<{ agent: AgentName; profileName: string }>;
    applied: ApplyResult;
  }>;
}

interface ProfileApplyDependencies {
  profileService?: ProfileService;
  snapshotService?: ProfileSnapshotService;
  writers?: Partial<Record<AgentName, AgentConfigWriter>>;
}

export function createProfileApplyService(
  deps: ProfileApplyDependencies = {}
): ProfileApplyService {
  const profileService = deps.profileService ?? createProfileService();
  const snapshotService = deps.snapshotService ?? createProfileSnapshotService();

  const defaultWriters: Partial<Record<AgentName, AgentConfigWriter>> = {
    claude: createClaudeWriter(),
    codex: createCodexWriter(),
    gemini: createGeminiWriter(),
  };
  const writers = { ...defaultWriters, ...deps.writers };

  return {
    async execute(options) {
      const cwd = options.cwd ?? process.cwd();
      const profile = await profileService.get({ cwd, name: options.profileName });

      const remoteMcpName = Object.entries(profile.mcps).find(
        ([, config]) => config.kind === 'remote'
      )?.[0];
      if (remoteMcpName) {
        throw new ProfileError(
          `Profile "${profile.name}" includes remote MCP "${remoteMcpName}". Remote MCP apply is not supported yet.`
        );
      }

      const isPartial = options.items !== undefined && options.items.length > 0;
      const shouldBackup = options.backup ?? !isPartial;

      const backups: Array<{ agent: AgentName; profileName: string }> = [];
      if (shouldBackup) {
        for (const agent of options.agents) {
          const backupName = defaultBackupProfileName(agent);
          try {
            await snapshotService.execute({ cwd, agent, profileName: backupName });
            backups.push({ agent, profileName: backupName });
          } catch {
            // Agent may not have a live config to back up — skip silently
          }
        }
      }

      const folder = profileDir(cwd, options.profileName);
      const manifest = await readProfileManifest(folder);
      const applied: ApplyResult = [];

      const wantMcp = (name: string) => matches(options.items, 'mcp', name);
      const wantPlugin = (name: string) => matches(options.items, 'plugin', name);
      const wantSkill = (name: string) => matches(options.items, 'skill', name);

      for (const agent of options.agents) {
        const writer = writers[agent];
        if (!writer) continue;

        const filteredMcps = Object.fromEntries(
          Object.entries(profile.mcps).filter(([name]) => wantMcp(name))
        );

        let mcpResult: { configPath: string; backedUpTo: string | null };
        if (Object.keys(filteredMcps).length > 0 || options.items === undefined) {
          mcpResult = await writer.write({ mcpServers: filteredMcps, cwd });
        } else {
          mcpResult = { configPath: '', backedUpTo: null };
        }

        const pluginsInstalled: string[] = [];
        const pluginsByName = new Map<string, NonNullable<typeof manifest>['plugins'] extends Array<infer T> | undefined ? T : never>();
        for (const p of manifest?.plugins ?? []) {
          if (!wantPlugin(p.name)) continue;
          const existing = pluginsByName.get(p.name);
          if (!existing || p.agent === agent) pluginsByName.set(p.name, p);
        }
        for (const plugin of pluginsByName.values()) {
          const sourceDir = path.join(folder, plugin.archivePath);
          await installPlugin(sourceDir, plugin, agent);
          pluginsInstalled.push(plugin.name);
        }

        const userSkillsInstalled: string[] = [];
        const skillsByName = new Map<string, PortableUserSkillSnapshot>();
        for (const s of manifest?.userSkills ?? []) {
          if (!wantSkill(s.name)) continue;
          if (!skillsByName.has(s.name)) skillsByName.set(s.name, s);
          else if (s.agent === agent) skillsByName.set(s.name, s); // prefer matching source if available
        }
        for (const skill of skillsByName.values()) {
          const sourceDir = path.join(folder, skill.archivePath);
          await installUserSkill(sourceDir, skill, agent);
          userSkillsInstalled.push(skill.name);
        }

        applied.push({
          agent,
          configPath: mcpResult.configPath,
          backedUpTo: mcpResult.backedUpTo,
          mcpCount: Object.keys(filteredMcps).length,
          ...(pluginsInstalled.length > 0 ? { pluginsInstalled } : {}),
          ...(userSkillsInstalled.length > 0 ? { userSkillsInstalled } : {}),
        });
      }

      return { backups, applied };
    },
  };
}

function matches(
  items: ItemSelector[] | undefined,
  type: ItemType,
  name: string
): boolean {
  if (items === undefined) return true;
  return items.some((s) => s.type === type && s.name === name);
}

async function readProfileManifest(
  folder: string
): Promise<PortableProfileManifest | null> {
  try {
    const source = await readFile(path.join(folder, 'manifest.yaml'), 'utf8');
    const parsed = YAML.parse(source);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed as PortableProfileManifest;
  } catch {
    return null;
  }
}
