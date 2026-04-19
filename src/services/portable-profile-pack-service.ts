import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { cp, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';

import YAML from 'yaml';

import { ProfileError } from '../errors.js';
import type {
  AgentName,
  LocalBundledMcpServerConfig,
  McpServerConfig,
  PortableCredentialSpec,
  PortablePluginSnapshot,
  PortableProfileManifest,
  PortableUserSkillSnapshot,
  ProfileConfig,
} from '../types.js';
import { createAgentConfigService, type AgentConfigService } from './agent-config-service.js';
import type { AgentLiveConfig, AgentSkillEntry } from './sync/agent-reader.js';
import { redactPortableMcpCredentials } from './credential-redaction-service.js';
import { createProfileService, type ProfileService } from './profile-service.js';
import { classifyPortableMcp } from './portable-mcp-classifier.js';
import { findProjectRoot, getDefaultExclude, getDefaultInstall } from './runtime-detector.js';

const packageVersion = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
) as { version: string };

export type PortablePackSource =
  | { source: 'profile'; name: string }
  | { source: 'agent'; agent: AgentName; cwd: string };

export interface PortableProfilePackService {
  execute(options: {
    cwd?: string;
    source: PortablePackSource;
    outputPath?: string;
  }): Promise<{ archivePath: string }>;
}

interface PortableProfilePackServiceDependencies {
  profileService?: Pick<ProfileService, 'get'>;
  agentConfigService?: Pick<AgentConfigService, 'readAll'>;
}

export function createPortableProfilePackService(
  deps: PortableProfilePackServiceDependencies = {}
): PortableProfilePackService {
  const profileService = deps.profileService ?? createProfileService();
  const agentConfigService = deps.agentConfigService ?? createAgentConfigService();

  return {
    async execute(options) {
      const cwd = options.source.source === 'agent' ? options.source.cwd : options.cwd ?? process.cwd();
      const stagingDir = await mkdtemp(path.join(tmpdir(), 'brainctl-pack-'));

      try {
        const packed = await buildPackedProfile({
          cwd,
          source: options.source,
          profileService,
          agentConfigService,
        });

        await writeFile(path.join(stagingDir, 'manifest.yaml'), YAML.stringify(packed.manifest), 'utf8');
        await writeFile(path.join(stagingDir, 'profile.yaml'), YAML.stringify(packed.profile), 'utf8');

        for (const [key, sourcePath] of packed.bundledSources) {
          const destPath = path.join(stagingDir, 'mcps', key);
          await mkdir(destPath, { recursive: true });
          const excludePatterns = getExcludePatternsForMcp(packed.profile.mcps[key]);
          await cp(sourcePath, destPath, {
            recursive: true,
            filter: (src) => !matchesExcludePattern(src, excludePatterns),
          });
        }

        for (const [archivePath, sourcePath] of packed.bundledPlugins) {
          const destPath = path.join(stagingDir, archivePath);
          await mkdir(path.dirname(destPath), { recursive: true });
          await cp(sourcePath, destPath, {
            recursive: true,
            filter: (src) => !matchesPluginExclude(src),
          });
        }

        for (const [archivePath, sourcePath] of packed.bundledUserSkills) {
          const destPath = path.join(stagingDir, archivePath);
          await mkdir(path.dirname(destPath), { recursive: true });
          await cp(sourcePath, destPath, {
            recursive: true,
            filter: (src) => !matchesPluginExclude(src),
          });
        }

        const outputPath = options.outputPath ?? path.join(cwd, `${packed.profile.name}.tar.gz`);
        execSync(`tar -czf "${outputPath}" -C "${stagingDir}" .`, {
          stdio: 'pipe',
        });

        return { archivePath: outputPath };
      } finally {
        await rm(stagingDir, { recursive: true, force: true });
      }
    },
  };
}

async function buildPackedProfile(options: {
  cwd: string;
  source: PortablePackSource;
  profileService: Pick<ProfileService, 'get'>;
  agentConfigService: Pick<AgentConfigService, 'readAll'>;
}): Promise<{
  manifest: PortableProfileManifest;
  profile: ProfileConfig;
  bundledSources: Map<string, string>;
  bundledPlugins: Map<string, string>;
  bundledUserSkills: Map<string, string>;
}> {
  if (options.source.source === 'profile') {
    const profile = await options.profileService.get({
      cwd: options.cwd,
      name: options.source.name,
    });
    return redactAndNormalizeProfile(profile, options.cwd, {
      kind: 'profile',
      profileName: profile.name,
    });
  }

  const agentSource = options.source;
  const configs = await options.agentConfigService.readAll({ cwd: agentSource.cwd });
  const agentConfig = configs.find((config) => config.agent === agentSource.agent);
  if (!agentConfig?.exists) {
    throw new ProfileError(`Agent "${agentSource.agent}" does not have a live config to pack.`);
  }

  const mcpKeys = new Set([
    ...Object.keys(agentConfig.mcpServers),
    ...Object.keys(agentConfig.remoteMcpServers),
  ]);
  const mcps = Object.fromEntries(
    Array.from(mcpKeys, (key) => {
      const classified = classifyPortableMcp({
        cwd: options.cwd,
        key,
        entry: agentConfig.mcpServers[key] ?? { command: '' },
        remote: agentConfig.remoteMcpServers[key],
      });

      if (classified.kind === 'local' && classified.source === 'bundled') {
        const entrypoint = agentConfig.mcpServers[key]?.args?.[0];
        const entrypointPath = entrypoint
          ? path.resolve(agentSource.cwd, entrypoint)
          : classified.path;
        const { marker } = findProjectRoot(entrypointPath, classified.runtime);
        if (!classified.install) {
          const defaultInstall = getDefaultInstall(classified.runtime, marker, classified.path, entrypoint);
          if (defaultInstall) {
            classified.install = defaultInstall;
          }
        }
        if (!classified.exclude) {
          const defaultExclude = getDefaultExclude(classified.runtime, marker);
          if (defaultExclude) {
            classified.exclude = defaultExclude;
          }
        }
      }

      return [key, classified];
    })
  );

  const profileName = `${sanitizePackName(path.basename(options.cwd) || 'workspace')}-${agentSource.agent}`;
  const extras = collectAgentExtras(agentConfig);
  return redactAndNormalizeProfile(
    {
      name: profileName,
      skills: {},
      mcps,
      memory: { paths: [] },
    },
    agentSource.cwd,
    {
      kind: 'agent',
      agent: agentSource.agent,
    },
    extras
  );
}

function collectAgentExtras(agentConfig: AgentLiveConfig): {
  plugins: PortablePluginSnapshot[];
  bundledPlugins: Map<string, string>;
  userSkills: PortableUserSkillSnapshot[];
  bundledUserSkills: Map<string, string>;
} {
  const plugins: PortablePluginSnapshot[] = [];
  const bundledPlugins = new Map<string, string>();
  const userSkills: PortableUserSkillSnapshot[] = [];
  const bundledUserSkills = new Map<string, string>();

  for (const skill of agentConfig.skills) {
    if (skill.kind === 'plugin') {
      const installPath = skill.installPath;
      const source = skill.source;
      if (!installPath || !source) continue;
      const safeName = sanitizePackName(`${skill.name}--${source}`);
      const archivePath = `plugins/${agentConfig.agent}/${safeName}`;
      bundledPlugins.set(archivePath, installPath);
      plugins.push({
        agent: agentConfig.agent,
        name: skill.name,
        source,
        marketplace: inferMarketplace(agentConfig.agent, installPath, source),
        version: inferPluginVersion(agentConfig.agent, installPath),
        archivePath,
        ...(skill.managed ? { managed: true } : {}),
        ...(skill.pluginSkills && skill.pluginSkills.length > 0 ? { pluginSkills: skill.pluginSkills } : {}),
        ...(skill.pluginMcps && skill.pluginMcps.length > 0 ? { pluginMcps: skill.pluginMcps } : {}),
        ...(skill.pluginAgents && skill.pluginAgents.length > 0 ? { pluginAgents: skill.pluginAgents } : {}),
        ...(skill.pluginCommands && skill.pluginCommands.length > 0 ? { pluginCommands: skill.pluginCommands } : {}),
      });
      continue;
    }

    if (skill.kind === 'skill' && skill.source === 'local') {
      const localSkillDir = path.join(homedir(), `.${agentConfig.agent}`, 'skills', skill.name);
      const archivePath = `skills/${agentConfig.agent}/${skill.name}`;
      bundledUserSkills.set(archivePath, localSkillDir);
      userSkills.push({
        agent: agentConfig.agent,
        name: skill.name,
        archivePath,
      });
    }
  }

  return { plugins, bundledPlugins, userSkills, bundledUserSkills };
}

function inferMarketplace(agent: AgentName, installPath: string, source: string): string {
  const cacheSegment = path.join(homedir(), `.${agent}`, 'plugins', 'cache') + path.sep;
  if (installPath.startsWith(cacheSegment)) {
    const tail = installPath.slice(cacheSegment.length).split(path.sep);
    if (tail.length > 0 && tail[0].length > 0) return tail[0];
  }
  return source;
}

function inferPluginVersion(agent: AgentName, installPath: string): string | undefined {
  const cacheSegment = path.join(homedir(), `.${agent}`, 'plugins', 'cache') + path.sep;
  if (installPath.startsWith(cacheSegment)) {
    const tail = installPath.slice(cacheSegment.length).split(path.sep);
    if (tail.length >= 3) return tail[2];
  }
  const base = path.basename(installPath);
  return base.length > 0 ? base : undefined;
}

function redactAndNormalizeProfile(
  profile: ProfileConfig,
  cwd: string,
  source: PortableProfileManifest['source'],
  extras?: {
    plugins: PortablePluginSnapshot[];
    bundledPlugins: Map<string, string>;
    userSkills: PortableUserSkillSnapshot[];
    bundledUserSkills: Map<string, string>;
  }
): {
  manifest: PortableProfileManifest;
  profile: ProfileConfig;
  bundledSources: Map<string, string>;
  bundledPlugins: Map<string, string>;
  bundledUserSkills: Map<string, string>;
} {
  const bundledSources = new Map<string, string>();
  const credentials = new Map<string, PortableCredentialSpec>();
  const mcps = Object.fromEntries(
    Object.entries(profile.mcps).map(([key, config]) => {
      const result = redactPortableMcpCredentials(config);
      for (const credential of result.credentials) {
        credentials.set(credential.key, credential);
      }

      if (result.redacted.kind === 'local' && result.redacted.source === 'bundled') {
        const sourcePath = path.isAbsolute(result.redacted.path)
          ? result.redacted.path
          : path.resolve(cwd, result.redacted.path);
        bundledSources.set(key, sourcePath);
        return [
          key,
          {
            ...result.redacted,
            path: `./mcps/${key}`,
          },
        ];
      }

      return [key, result.redacted];
    })
  );

  const hasExtras =
    extras !== undefined && (extras.plugins.length > 0 || extras.userSkills.length > 0);

  return {
    manifest: {
      schemaVersion: hasExtras ? 2 : 1,
      profileName: profile.name,
      createdBy: {
        tool: 'brainctl',
        version: packageVersion.version,
      },
      ...(source ? { source } : {}),
      ...(credentials.size > 0 ? { credentials: Array.from(credentials.values()) } : {}),
      ...(extras && extras.plugins.length > 0 ? { plugins: extras.plugins } : {}),
      ...(extras && extras.userSkills.length > 0 ? { userSkills: extras.userSkills } : {}),
    },
    profile: {
      ...profile,
      mcps,
    },
    bundledSources,
    bundledPlugins: extras?.bundledPlugins ?? new Map(),
    bundledUserSkills: extras?.bundledUserSkills ?? new Map(),
  };
}

function sanitizePackName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'workspace';
}

function getExcludePatternsForMcp(mcp: McpServerConfig): string[] {
  if (mcp.kind === 'local' && mcp.source === 'bundled' && mcp.exclude) {
    return mcp.exclude;
  }
  return ['node_modules'];
}

function matchesPluginExclude(filePath: string): boolean {
  const basename = path.basename(filePath);
  return basename === '.git' || basename === '.DS_Store';
}

function matchesExcludePattern(filePath: string, patterns: string[]): boolean {
  const basename = path.basename(filePath);
  for (const pattern of patterns) {
    if (pattern.startsWith('*')) {
      if (basename.endsWith(pattern.slice(1))) return true;
    } else if (basename === pattern) {
      return true;
    }
  }
  return false;
}
