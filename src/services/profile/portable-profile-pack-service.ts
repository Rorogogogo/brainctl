import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';

import YAML from 'yaml';

import { ProfileError } from '../../errors.js';
import type {
  AgentName,
  LocalBundledMcpServerConfig,
  McpServerConfig,
  PortableCredentialSpec,
  PortablePluginSnapshot,
  PortableProfileManifest,
  PortableUserSkillSnapshot,
  ProfileConfig,
} from '../../types.js';
import { createAgentConfigService, type AgentConfigService } from '../agent/agent-config-service.js';
import type { AgentLiveConfig, AgentSkillEntry } from '../sync/agent-reader.js';
import { redactPortableMcpCredentials } from '../credential/credential-redaction-service.js';
import { createProfileService, profileDir, type ProfileService } from './profile-service.js';
import { classifyPortableMcp } from './portable-mcp-classifier.js';
import { findProjectRoot, getDefaultExclude, getDefaultInstall } from '../platform/runtime-detector.js';

const packageVersion = JSON.parse(
  readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')
) as { version: string };

export type PortablePackSource =
  | { source: 'profile'; name: string }
  | { source: 'agent'; agent: AgentName; cwd: string };

export type PortablePackFormat = 'tarball' | 'folder';
export type PortableCredentialsMode = 'redact' | 'keep';

export type PortablePackProgress = (message: string) => void;

export interface PortableProfilePackService {
  execute(options: {
    cwd?: string;
    source: PortablePackSource;
    outputPath?: string;
    format?: PortablePackFormat;
    credentialsMode?: PortableCredentialsMode;
    onProgress?: PortablePackProgress;
  }): Promise<{ archivePath: string; format: PortablePackFormat; warnings: string[] }>;
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
      const report = options.onProgress ?? (() => {});

      try {
        report(
          options.source.source === 'agent'
            ? `Reading ${options.source.agent} config and skills…`
            : `Loading profile "${options.source.name}"…`
        );
        const packed = await buildPackedProfile({
          cwd,
          source: options.source,
          profileService,
          agentConfigService,
        });
        report(
          `Found ${Object.keys(packed.profile.mcps).length} MCP(s), ${packed.bundledPlugins.size} plugin dir(s), ${packed.bundledUserSkills.size} user-skill dir(s).`
        );

        await writeFile(path.join(stagingDir, 'manifest.yaml'), YAML.stringify(packed.manifest), 'utf8');
        await writeFile(path.join(stagingDir, 'profile.yaml'), YAML.stringify(packed.profile), 'utf8');

        if (packed.bundledSources.size > 0) {
          report(`Bundling ${packed.bundledSources.size} MCP source dir(s)…`);
        }
        let mcpIndex = 0;
        for (const [key, sourcePath] of packed.bundledSources) {
          mcpIndex += 1;
          report(`  [${mcpIndex}/${packed.bundledSources.size}] copying MCP "${key}"`);
          try {
            await stat(sourcePath);
          } catch {
            throw new Error(
              `Bundled MCP "${key}" cannot be packed: source directory not found at ${sourcePath}. Remove the MCP from this profile or fix its path, then try again.`
            );
          }
          const destPath = path.join(stagingDir, 'mcps', key);
          await mkdir(destPath, { recursive: true });
          const excludePatterns = getExcludePatternsForMcp(packed.profile.mcps[key]);
          await cp(sourcePath, destPath, {
            recursive: true,
            filter: (src) => !matchesExcludePattern(src, excludePatterns),
          });
        }

        if (packed.bundledPlugins.size > 0) {
          report(`Bundling ${packed.bundledPlugins.size} plugin dir(s)…`);
        }
        for (const [archivePath, sourcePath] of packed.bundledPlugins) {
          const destPath = path.join(stagingDir, archivePath);
          await mkdir(path.dirname(destPath), { recursive: true });
          await cp(sourcePath, destPath, {
            recursive: true,
            filter: (src) => !matchesPluginExclude(src),
          });
        }

        if (packed.bundledUserSkills.size > 0) {
          report(`Bundling ${packed.bundledUserSkills.size} user-skill dir(s)…`);
        }
        for (const [archivePath, sourcePath] of packed.bundledUserSkills) {
          const destPath = path.join(stagingDir, archivePath);
          await mkdir(path.dirname(destPath), { recursive: true });
          await cp(sourcePath, destPath, {
            recursive: true,
            filter: (src) => !matchesPluginExclude(src),
          });
        }

        const format: PortablePackFormat = options.format ?? 'tarball';
        const credentialsMode: PortableCredentialsMode = options.credentialsMode ?? 'redact';
        const warnings: string[] = [];

        if (credentialsMode === 'keep' && Object.keys(packed.rawCredentials).length > 0) {
          await writeFile(
            path.join(stagingDir, '.env'),
            renderDotEnv(packed.rawCredentials),
            'utf8'
          );
          warnings.push(
            `Wrote .env with ${Object.keys(packed.rawCredentials).length} real credential value(s). Do NOT publish this archive publicly.`
          );
        }

        if (format === 'folder') {
          await writeRepoReadyFiles(stagingDir, packed);
          const outputPath =
            options.outputPath ?? path.join(cwd, packed.profile.name);
          report(`Writing folder profile to ${outputPath}…`);
          await rm(outputPath, { recursive: true, force: true });
          await mkdir(path.dirname(outputPath), { recursive: true });
          await cp(stagingDir, outputPath, { recursive: true });
          report('Done.');
          return { archivePath: outputPath, format, warnings };
        }

        const outputPath = options.outputPath ?? path.join(cwd, `${packed.profile.name}.tar.gz`);
        report(`Compressing tarball to ${outputPath}…`);
        execSync(`tar -czf "${outputPath}" -C "${stagingDir}" .`, {
          stdio: 'pipe',
        });
        report('Done.');

        return { archivePath: outputPath, format, warnings };
      } finally {
        await rm(stagingDir, { recursive: true, force: true });
      }
    },
  };
}

function renderDotEnv(values: Record<string, string>): string {
  return (
    Object.entries(values)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key.toUpperCase()}=${escapeEnvValue(value)}`)
      .join('\n') + '\n'
  );
}

function escapeEnvValue(value: string): string {
  if (/[\s"'#$\\]/.test(value)) {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return value;
}

async function writeRepoReadyFiles(
  stagingDir: string,
  packed: {
    manifest: PortableProfileManifest;
    profile: ProfileConfig;
  }
): Promise<void> {
  const credentials = packed.manifest.credentials ?? [];
  const envLines = credentials.map((c) => `${c.key.toUpperCase()}=${c.description ? `# ${c.description}` : ''}`);
  const envExample = envLines.length > 0
    ? `# Credentials required by this profile\n# Copy to .env and fill in values before \`brainctl profile import\`.\n${envLines.join('\n')}\n`
    : '# No credentials required by this profile.\n';

  const gitignore = ['.env', 'node_modules/', '.DS_Store', '*.bak.*', ''].join('\n');

  const readme = renderReadme(packed);

  await writeFile(path.join(stagingDir, '.env.example'), envExample, 'utf8');
  await writeFile(path.join(stagingDir, '.gitignore'), gitignore, 'utf8');
  await writeFile(path.join(stagingDir, 'README.md'), readme, 'utf8');
}

function renderReadme(packed: {
  manifest: PortableProfileManifest;
  profile: ProfileConfig;
}): string {
  const { manifest, profile } = packed;
  const mcpNames = Object.keys(profile.mcps);
  const credNames = (manifest.credentials ?? []).map((c) => `- \`${c.key}\`${c.description ? ` — ${c.description}` : ''}`);

  const lines: string[] = [
    `# ${profile.name}`,
    '',
    profile.description ?? 'A brainctl portable profile.',
    '',
    `Packed by ${manifest.createdBy?.tool ?? 'brainctl'} v${manifest.createdBy?.version ?? packageVersion.version}.`,
    '',
    '## Contents',
    '',
    `- **MCPs:** ${mcpNames.length > 0 ? mcpNames.join(', ') : '(none)'}`,
    ...(manifest.plugins ? [`- **Plugins:** ${manifest.plugins.map((p) => `${p.agent}:${p.name}`).join(', ')}`] : []),
    ...(manifest.userSkills ? [`- **User skills:** ${manifest.userSkills.map((s) => `${s.agent}:${s.name}`).join(', ')}`] : []),
    '',
    '## Install',
    '',
    '```bash',
    `brainctl profile import ./${profile.name}`,
    '```',
    '',
  ];

  if (credNames.length > 0) {
    lines.push(
      '## Required credentials',
      '',
      'Copy `.env.example` to `.env` (gitignored) and fill in values, or pass them at import time:',
      '',
      '```bash',
      `brainctl profile import ./${profile.name} \\`,
      ...credNames.map((c) => {
        const key = c.match(/`([^`]+)`/)?.[1] ?? '';
        return `  --credential ${key}=<value> \\`;
      }),
      '```',
      '',
      '### Keys',
      '',
      ...credNames,
      '',
    );
  }

  return lines.join('\n');
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
  rawCredentials: Record<string, string>;
}> {
  if (options.source.source === 'profile') {
    const profile = await options.profileService.get({
      cwd: options.cwd,
      name: options.source.name,
    });
    return redactAndNormalizeProfile(
      profile,
      options.cwd,
      { kind: 'profile', profileName: profile.name },
      { bundledBaseDir: profileDir(options.cwd, options.source.name) }
    );
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
      mcps,
    },
    agentSource.cwd,
    {
      kind: 'agent',
      agent: agentSource.agent,
    },
    undefined,
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
  const pluginOwnedSkillNames = new Set(
    agentConfig.skills
      .filter((skill) => skill.kind === 'plugin')
      .flatMap((skill) => skill.pluginSkills ?? [])
  );

  for (const skill of agentConfig.skills) {
    if (skill.kind === 'plugin') {
      const installPath = skill.installPath;
      const source = skill.source;
      if (!installPath || !source) continue;
      const safeName = sanitizePackName(skill.name);
      const archivePath = `plugins/${safeName}`;
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

    if (skill.kind === 'skill' && (skill.source === 'local' || skill.source === 'linked')) {
      if (pluginOwnedSkillNames.has(skill.name)) continue;
      const scope = skill.scope ?? 'user';
      // Project-scoped skills carry their absolute installPath; user-scoped
      // skills live at the well-known home-rooted location.
      const localSkillDir = skill.installPath
        ?? path.join(homedir(), `.${agentConfig.agent}`, 'skills', skill.name);
      // Disambiguate project vs user skills with the same name in the archive
      // by prefixing the project-skill bucket.
      const archivePath =
        scope === 'project'
          ? `project-skills/${sanitizePackName(skill.name)}`
          : `skills/${sanitizePackName(skill.name)}`;
      bundledUserSkills.set(archivePath, localSkillDir);
      userSkills.push({
        agent: agentConfig.agent,
        name: skill.name,
        archivePath,
        ...(scope === 'project' ? { scope: 'project' as const } : {}),
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

async function redactAndNormalizeProfile(
  profile: ProfileConfig,
  cwd: string,
  source: PortableProfileManifest['source'],
  options?: { bundledBaseDir?: string },
  extras?: {
    plugins: PortablePluginSnapshot[];
    bundledPlugins: Map<string, string>;
    userSkills: PortableUserSkillSnapshot[];
    bundledUserSkills: Map<string, string>;
  }
): Promise<{
  manifest: PortableProfileManifest;
  profile: ProfileConfig;
  bundledSources: Map<string, string>;
  bundledPlugins: Map<string, string>;
  bundledUserSkills: Map<string, string>;
  rawCredentials: Record<string, string>;
}> {
  const bundledSources = new Map<string, string>();
  const credentials = new Map<string, PortableCredentialSpec>();
  const rawCredentials: Record<string, string> = {};
  const mcps = Object.fromEntries(
    Object.entries(profile.mcps).map(([key, config]) => {
      const result = redactPortableMcpCredentials(config);
      for (const credential of result.credentials) {
        credentials.set(credential.key, credential);
      }
      for (const [credKey, credValue] of Object.entries(result.rawValues)) {
        rawCredentials[credKey] = credValue;
      }

      if (result.redacted.kind === 'local' && result.redacted.source === 'bundled') {
        const baseDir = options?.bundledBaseDir ?? cwd;
        const sourcePath = path.isAbsolute(result.redacted.path)
          ? result.redacted.path
          : path.resolve(baseDir, result.redacted.path);
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
      schemaVersion: hasExtras ? 3 : 1,
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
    rawCredentials,
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
