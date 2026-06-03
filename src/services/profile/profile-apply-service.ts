import { readFile, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

import YAML from 'yaml';

import { ProfileError } from '../../errors.js';
import type {
  AgentName,
  McpServerConfig,
  PortableProfileManifest,
  PortableUserSkillSnapshot,
  SyncResult,
} from '../../types.js';
import { installPlugin, installUserSkill } from '../agent/agent-asset-installer.js';
import {
  createAgentConfigService,
  type AgentConfigService,
} from '../agent/agent-config-service.js';
import { createPluginInstallService } from '../plugin/plugin-install-service.js';
import {
  createProfileSnapshotService,
  defaultBackupProfileName,
  type ProfileSnapshotService,
} from './profile-snapshot-service.js';
import { createProfileService, profileDir, type ProfileService } from './profile-service.js';
import type { AgentConfigWriter } from '../sync/agent-writer.js';
import { createClaudeWriter } from '../sync/claude-writer.js';
import { createCodexWriter } from '../sync/codex-writer.js';
import { createAntigravityWriter } from '../sync/antigravity-writer.js';
import { normalizePortableProfileManifest } from './profile-manifest-normalizer.js';

export type ItemType = 'mcp' | 'plugin' | 'skill';

export interface ItemSelector {
  type: ItemType;
  name: string;
}

export type ProfileApplyItemActionKind = 'replace' | 'keep-both' | 'drop';

export interface ProfileApplyItemAction extends ItemSelector {
  agent: AgentName;
  action: ProfileApplyItemActionKind;
  targetName?: string;
}

export interface ApplyOptions {
  cwd?: string;
  profileName: string;
  agents: AgentName[];
  items?: ItemSelector[]; // undefined = everything matching
  itemActions?: ProfileApplyItemAction[];
  backup?: boolean; // default true for full apply, false for partial
  replace?: boolean; // when true, uninstall live plugins/skills not present in the profile (DESTRUCTIVE; default false)
}

export interface ApplyResult extends SyncResult {}

export interface ProfileApplyService {
  execute(options: ApplyOptions): Promise<{
    backups: Array<{ agent: AgentName; profileName: string }>;
    applied: ApplyResult;
    unresolvedCredentials: string[];
  }>;
}

interface ProfileApplyDependencies {
  profileService?: ProfileService;
  snapshotService?: ProfileSnapshotService;
  agentConfigService?: AgentConfigService;
  writers?: Partial<Record<AgentName, AgentConfigWriter>>;
}

export function createProfileApplyService(
  deps: ProfileApplyDependencies = {}
): ProfileApplyService {
  const profileService = deps.profileService ?? createProfileService();
  const snapshotService = deps.snapshotService ?? createProfileSnapshotService();
  const agentConfigService = deps.agentConfigService ?? createAgentConfigService();
  const pluginInstallService = createPluginInstallService();

  const defaultWriters: Partial<Record<AgentName, AgentConfigWriter>> = {
    claude: createClaudeWriter(),
    codex: createCodexWriter(),
    antigravity: createAntigravityWriter(),
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

      const unresolvedCredentials = findUnresolvedCredentialPlaceholders(profile.mcps);

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

      const wantMcp = (agent: AgentName, name: string) =>
        matches(options.items, 'mcp', name) &&
        actionFor(options.itemActions, agent, 'mcp', name)?.action !== 'drop';
      const wantPlugin = (agent: AgentName, name: string) =>
        matches(options.items, 'plugin', name) &&
        actionFor(options.itemActions, agent, 'plugin', name)?.action !== 'drop';
      const wantSkill = (agent: AgentName, name: string) =>
        matches(options.items, 'skill', name) &&
        actionFor(options.itemActions, agent, 'skill', name)?.action !== 'drop';

      for (const agent of options.agents) {
        const writer = writers[agent];
        if (!writer) continue;

        const filteredMcps = Object.fromEntries(
          Object.entries(profile.mcps)
            .filter(([name]) => wantMcp(agent, name))
            .map(([name, config]) => [
              targetNameFor(options.itemActions, agent, 'mcp', name),
              config,
            ])
        );

        let mcpResult: { configPath: string; backedUpTo: string | null };
        if (Object.keys(filteredMcps).length > 0 || options.items === undefined) {
          mcpResult = await writer.write({
            mcpServers: filteredMcps,
            cwd,
            merge: options.replace !== true,
          });
        } else {
          mcpResult = { configPath: '', backedUpTo: null };
        }

        const pluginsInstalled: string[] = [];
        const pluginsByName = new Map<string, NonNullable<typeof manifest>['plugins'] extends Array<infer T> | undefined ? T : never>();
        for (const p of manifest?.plugins ?? []) {
          if (!wantPlugin(agent, p.name)) continue;
          const action = actionFor(options.itemActions, agent, 'plugin', p.name);
          if (action?.action === 'keep-both') {
            throw new ProfileError(
              `Plugin "${p.name}" cannot use keep-both when applying a profile. Drop it or replace the existing plugin.`
            );
          }
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
          if (!wantSkill(agent, s.name)) continue;
          const targetName = targetNameFor(options.itemActions, agent, 'skill', s.name);
          const selectedSkill = targetName === s.name ? s : { ...s, name: targetName };
          if (!skillsByName.has(targetName)) skillsByName.set(targetName, selectedSkill);
          else if (s.agent === agent) skillsByName.set(targetName, selectedSkill); // prefer matching source if available
        }
        for (const skill of skillsByName.values()) {
          const sourceDir = path.join(folder, skill.archivePath);
          await installUserSkill(sourceDir, skill, agent, { cwd });
          userSkillsInstalled.push(skill.name);
        }

        const pluginsRemoved: string[] = [];
        const userSkillsRemoved: string[] = [];
        if (options.items === undefined && options.replace === true) {
          const cleanup = await cleanupExtras({
            agent,
            cwd,
            keepPlugins: new Set(pluginsByName.keys()),
            keepSkills: new Set(skillsByName.keys()),
            agentConfigService,
            pluginInstallService,
          });
          pluginsRemoved.push(...cleanup.pluginsRemoved);
          userSkillsRemoved.push(...cleanup.userSkillsRemoved);
        }

        applied.push({
          agent,
          configPath: mcpResult.configPath,
          backedUpTo: mcpResult.backedUpTo,
          mcpCount: Object.keys(filteredMcps).length,
          ...(pluginsInstalled.length > 0 ? { pluginsInstalled } : {}),
          ...(userSkillsInstalled.length > 0 ? { userSkillsInstalled } : {}),
          ...(pluginsRemoved.length > 0 ? { pluginsRemoved } : {}),
          ...(userSkillsRemoved.length > 0 ? { userSkillsRemoved } : {}),
        });
      }

      return { backups, applied, unresolvedCredentials };
    },
  };
}

async function cleanupExtras(options: {
  agent: AgentName;
  cwd: string;
  keepPlugins: Set<string>;
  keepSkills: Set<string>;
  agentConfigService: AgentConfigService;
  pluginInstallService: ReturnType<typeof createPluginInstallService>;
}): Promise<{ pluginsRemoved: string[]; userSkillsRemoved: string[] }> {
  const pluginsRemoved: string[] = [];
  const userSkillsRemoved: string[] = [];

  const live = await options.agentConfigService.readAll({ cwd: options.cwd });
  const agentConfig = live.find((c) => c.agent === options.agent);
  if (!agentConfig?.exists) return { pluginsRemoved, userSkillsRemoved };

  for (const entry of agentConfig.skills) {
    if (entry.kind === 'plugin') {
      if (options.keepPlugins.has(entry.name)) continue;
      try {
        await options.pluginInstallService.remove({
          cwd: options.cwd,
          targetAgent: options.agent,
          plugin: entry,
        });
        pluginsRemoved.push(entry.name);
      } catch {
        // best-effort cleanup
      }
    } else {
      if (options.keepSkills.has(entry.name)) continue;
      const skillDir =
        entry.scope === 'project'
          ? path.join(options.cwd, '.claude', 'skills', entry.name)
          : path.join(homedir(), `.${options.agent}`, 'skills', entry.name);
      try {
        await rm(skillDir, { recursive: true, force: true });
        userSkillsRemoved.push(entry.name);
      } catch {
        // best-effort cleanup
      }
    }
  }

  return { pluginsRemoved, userSkillsRemoved };
}

function matches(
  items: ItemSelector[] | undefined,
  type: ItemType,
  name: string
): boolean {
  if (items === undefined) return true;
  return items.some((s) => s.type === type && s.name === name);
}

function actionFor(
  actions: ProfileApplyItemAction[] | undefined,
  agent: AgentName,
  type: ItemType,
  name: string
): ProfileApplyItemAction | undefined {
  return actions?.find(
    (action) => action.agent === agent && action.type === type && action.name === name
  );
}

function targetNameFor(
  actions: ProfileApplyItemAction[] | undefined,
  agent: AgentName,
  type: ItemType,
  name: string
): string {
  const action = actionFor(actions, agent, type, name);
  if (action?.action !== 'keep-both') return name;

  const targetName = action.targetName?.trim();
  if (!targetName) {
    throw new ProfileError(
      `${typeLabel(type)} "${name}" cannot use keep-both without a target name.`
    );
  }
  return targetName;
}

function typeLabel(type: ItemType): string {
  return type === 'mcp' ? 'MCP' : type === 'plugin' ? 'Plugin' : 'Skill';
}

async function readProfileManifest(
  folder: string
): Promise<PortableProfileManifest | null> {
  try {
    const source = await readFile(path.join(folder, 'manifest.yaml'), 'utf8');
    const parsed = YAML.parse(source);
    if (!parsed || typeof parsed !== 'object') return null;
    return normalizePortableProfileManifest(parsed as PortableProfileManifest);
  } catch {
    return null;
  }
}

const CREDENTIAL_PLACEHOLDER_PATTERN = /\$\{\s*credentials\.([^}\s]+)\s*\}/g;

function findUnresolvedCredentialPlaceholders(
  mcps: Record<string, McpServerConfig>
): string[] {
  const keys = new Set<string>();
  const visit = (value: unknown) => {
    if (typeof value === 'string') {
      for (const match of value.matchAll(CREDENTIAL_PLACEHOLDER_PATTERN)) {
        keys.add(match[1]);
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (value && typeof value === 'object') {
      for (const item of Object.values(value)) visit(item);
    }
  };
  visit(mcps);
  return Array.from(keys).sort();
}
