import { cp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

import YAML from 'yaml';

import type {
  AgentName,
  McpServerConfig,
  PortablePluginSnapshot,
  PortableProfileManifest,
  PortableUserSkillSnapshot,
} from '../../types.js';
import { ProfileError, ProfileNotFoundError } from '../../errors.js';
import {
  createAgentConfigService,
  type AgentConfigService,
} from '../agent/agent-config-service.js';
import { classifyPortableMcp } from './portable-mcp-classifier.js';
import {
  createProfileService,
  profileDir,
  profileFile,
  type ProfileService,
} from './profile-service.js';

export type ProfileItemType = 'mcp' | 'plugin' | 'skill';

interface AddItemOptions {
  cwd?: string;
  profileName: string;
  agent: AgentName;
  type: ProfileItemType;
  name: string;
}

interface RemoveItemOptions {
  cwd?: string;
  profileName: string;
  type: ProfileItemType;
  name: string;
  agent?: AgentName;
}

export interface ProfileEditService {
  addItem(options: AddItemOptions): Promise<void>;
  removeItem(options: RemoveItemOptions): Promise<void>;
}

interface Deps {
  profileService?: ProfileService;
  agentConfigService?: AgentConfigService;
}

export function createProfileEditService(deps: Deps = {}): ProfileEditService {
  const profileService = deps.profileService ?? createProfileService();
  const agentConfigService = deps.agentConfigService ?? createAgentConfigService();

  return {
    async addItem(options) {
      const cwd = options.cwd ?? process.cwd();
      const profile = await profileService.get({ cwd, name: options.profileName });

      const live = await agentConfigService.readAll({ cwd });
      const agentConfig = live.find((c) => c.agent === options.agent);
      if (!agentConfig?.exists) {
        throw new ProfileError(
          `Agent "${options.agent}" has no live config to copy from.`
        );
      }

      if (options.type === 'mcp') {
        const entry = agentConfig.mcpServers[options.name];
        const remote = agentConfig.remoteMcpServers[options.name];
        if (!entry && !remote) {
          throw new ProfileError(
            `Agent "${options.agent}" has no MCP named "${options.name}".`
          );
        }
        const classified = classifyPortableMcp({
          cwd,
          key: options.name,
          entry: entry ?? { command: '' },
          remote,
        });
        const mcps: Record<string, McpServerConfig> = { ...profile.mcps };
        if (mcps[options.name]) {
          throw new ProfileError(
            `Profile "${options.profileName}" already has MCP "${options.name}".`
          );
        }
        mcps[options.name] = classified;
        await profileService.update({
          cwd,
          name: options.profileName,
          config: { ...profile, mcps },
        });
        return;
      }

      const skillEntry = agentConfig.skills.find((s) => s.name === options.name);
      if (!skillEntry?.installPath) {
        throw new ProfileError(
          `Agent "${options.agent}" has no ${options.type} named "${options.name}" with a known install path.`
        );
      }

      const safeName = sanitizeName(options.name);
      const subdir = options.type === 'plugin' ? 'plugins' : 'skills';
      const archivePath = `${subdir}/${safeName}`;
      const profileFolder = profileDir(cwd, options.profileName);
      const destDir = path.join(profileFolder, archivePath);

      const manifest = await readManifest(profileFolder, options.profileName);

      if (options.type === 'plugin') {
        if (skillEntry.kind !== 'plugin') {
          throw new ProfileError(
            `"${options.name}" on "${options.agent}" is a skill, not a plugin.`
          );
        }
        if (
          (manifest.plugins ?? []).some(
            (p) => p.agent === options.agent && p.name === options.name
          )
        ) {
          throw new ProfileError(
            `Profile "${options.profileName}" already has plugin "${options.name}" for ${options.agent}.`
          );
        }
        await rm(destDir, { recursive: true, force: true });
        await mkdir(path.dirname(destDir), { recursive: true });
        await cp(skillEntry.installPath, destDir, { recursive: true });
        const plugins = [...(manifest.plugins ?? [])];
        const next: PortablePluginSnapshot = {
          agent: options.agent,
          name: options.name,
          source: skillEntry.source ?? 'local',
          archivePath,
          ...(skillEntry.managed ? { managed: true } : {}),
          ...(skillEntry.pluginSkills?.length
            ? { pluginSkills: skillEntry.pluginSkills }
            : {}),
          ...(skillEntry.pluginMcps?.length ? { pluginMcps: skillEntry.pluginMcps } : {}),
          ...(skillEntry.pluginAgents?.length
            ? { pluginAgents: skillEntry.pluginAgents }
            : {}),
          ...(skillEntry.pluginCommands?.length
            ? { pluginCommands: skillEntry.pluginCommands }
            : {}),
        };
        plugins.push(next);
        manifest.plugins = plugins;
      } else {
        if (skillEntry.kind === 'plugin') {
          throw new ProfileError(
            `"${options.name}" on "${options.agent}" is a plugin, not a skill.`
          );
        }
        if (
          (manifest.userSkills ?? []).some(
            (s) => s.agent === options.agent && s.name === options.name
          )
        ) {
          throw new ProfileError(
            `Profile "${options.profileName}" already has skill "${options.name}" for ${options.agent}.`
          );
        }
        await rm(destDir, { recursive: true, force: true });
        await mkdir(path.dirname(destDir), { recursive: true });
        await cp(skillEntry.installPath, destDir, { recursive: true });
        const userSkills = [...(manifest.userSkills ?? [])];
        const next: PortableUserSkillSnapshot = {
          agent: options.agent,
          name: options.name,
          archivePath,
        };
        userSkills.push(next);
        manifest.userSkills = userSkills;
      }

      await writeManifest(profileFolder, manifest);
    },

    async removeItem(options) {
      const cwd = options.cwd ?? process.cwd();
      const profile = await profileService.get({ cwd, name: options.profileName });

      if (options.type === 'mcp') {
        if (!(options.name in profile.mcps)) {
          throw new ProfileError(
            `Profile "${options.profileName}" has no MCP "${options.name}".`
          );
        }
        const next: Record<string, McpServerConfig> = { ...profile.mcps };
        delete next[options.name];
        await profileService.update({
          cwd,
          name: options.profileName,
          config: { ...profile, mcps: next },
        });
        return;
      }

      const profileFolder = profileDir(cwd, options.profileName);
      const manifest = await readManifest(profileFolder, options.profileName);

      if (options.type === 'plugin') {
        const before = manifest.plugins ?? [];
        const removed = before.filter(
          (p) =>
            p.name === options.name &&
            (options.agent === undefined || p.agent === options.agent)
        );
        if (removed.length === 0) {
          throw new ProfileError(
            `Profile "${options.profileName}" has no plugin "${options.name}"${
              options.agent ? ` on ${options.agent}` : ''
            }.`
          );
        }
        const remaining = before.filter((p) => !removed.includes(p));
        manifest.plugins = remaining;
        for (const r of removed) {
          if (!remaining.some((p) => p.archivePath === r.archivePath)) {
            await rm(path.join(profileFolder, r.archivePath), {
              recursive: true,
              force: true,
            });
          }
        }
      } else {
        const before = manifest.userSkills ?? [];
        const removed = before.filter(
          (s) =>
            s.name === options.name &&
            (options.agent === undefined || s.agent === options.agent)
        );
        if (removed.length === 0) {
          throw new ProfileError(
            `Profile "${options.profileName}" has no skill "${options.name}"${
              options.agent ? ` on ${options.agent}` : ''
            }.`
          );
        }
        const remaining = before.filter((s) => !removed.includes(s));
        manifest.userSkills = remaining;
        for (const r of removed) {
          if (!remaining.some((s) => s.archivePath === r.archivePath)) {
            await rm(path.join(profileFolder, r.archivePath), {
              recursive: true,
              force: true,
            });
          }
        }
      }

      await writeManifest(profileFolder, manifest);
    },
  };
}

function sanitizeName(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, '-');
}

async function readManifest(
  profileFolder: string,
  profileName: string
): Promise<PortableProfileManifest> {
  const manifestPath = path.join(profileFolder, 'manifest.yaml');
  try {
    const source = await readFile(manifestPath, 'utf8');
    const parsed = YAML.parse(source) as Partial<PortableProfileManifest> | null;
    return {
      schemaVersion: 1,
      profileName,
      ...(parsed ?? {}),
    } as PortableProfileManifest;
  } catch {
    return { schemaVersion: 1, profileName };
  }
}

async function writeManifest(
  profileFolder: string,
  manifest: PortableProfileManifest
): Promise<void> {
  await mkdir(profileFolder, { recursive: true });
  const manifestPath = path.join(profileFolder, 'manifest.yaml');
  await writeFile(manifestPath, YAML.stringify(manifest), 'utf8');
}

export { ProfileNotFoundError };
