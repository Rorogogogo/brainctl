import { execSync } from 'node:child_process';
import { copyFile, cp, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';

import YAML from 'yaml';

import { ProfileError } from '../errors.js';
import type {
  McpServerConfig,
  PortablePluginSnapshot,
  PortableProfileManifest,
  PortableUserSkillSnapshot,
  ProfileConfig,
  RemoteMcpServerConfig,
} from '../types.js';
import { formatTimestamp } from './sync/agent-writer.js';
import { resolvePortableMcpCredentials } from './credential-resolution-service.js';
import { createMcpPreflightService, type McpPreflightService } from './mcp-preflight-service.js';
import { parseProfile } from './profile-service.js';

const PROFILES_DIR = '.brainctl/profiles';

export interface ProfileImportService {
  execute(options: {
    cwd?: string;
    archivePath: string;
    force?: boolean;
    credentials?: Record<string, string>;
  }): Promise<{
    profileName: string;
    installedMcps: string[];
    installedPlugins: string[];
    installedUserSkills: string[];
  }>;
}

interface ProfileImportServiceDependencies {
  mcpPreflightService?: Pick<McpPreflightService, 'execute'>;
}

export function createProfileImportService(
  deps: ProfileImportServiceDependencies = {}
): ProfileImportService {
  const mcpPreflightService = deps.mcpPreflightService ?? createMcpPreflightService();

  return {
    async execute(options) {
      const cwd = options.cwd ?? process.cwd();
      const archivePath = path.resolve(cwd, options.archivePath);

      try {
        await stat(archivePath);
      } catch {
        throw new ProfileError(`Archive not found: ${archivePath}`);
      }

      const extractDir = await mkdtemp(path.join(tmpdir(), 'brainctl-import-'));

      try {
        execSync(`tar -xzf "${archivePath}" -C "${extractDir}"`, {
          stdio: 'pipe',
        });

        const manifest = await readPortableManifest(extractDir);
        const profileSource = await readFile(
          path.join(extractDir, 'profile.yaml'),
          'utf8'
        );

        const profile = parseProfile(profileSource, 'imported');
        const profileName = profile.name;
        if (manifest.profileName !== profileName) {
          throw new ProfileError(
            `Portable profile manifest name "${manifest.profileName}" does not match profile name "${profileName}".`
          );
        }

        const profilePath = path.join(cwd, PROFILES_DIR, `${profileName}.yaml`);
        if (!options.force) {
          try {
            await stat(profilePath);
            throw new ProfileError(
              `Profile "${profileName}" already exists. Use --force to overwrite.`
            );
          } catch (err) {
            if (err instanceof ProfileError) throw err;
          }
        }

        const missingCredentials = new Map<string, string>();
        for (const [name, mcp] of Object.entries(profile.mcps)) {
          const resolution = resolvePortableMcpCredentials(mcp, {
            credentials: options.credentials,
            credentialSpecs: manifest.credentials,
            environment: process.env,
          });
          profile.mcps[name] = resolution.resolved;
          for (const credential of resolution.missing) {
            missingCredentials.set(credential.key, credential.description ?? credential.key);
          }
        }

        if (missingCredentials.size > 0) {
          throw new ProfileError(
            `Missing required credentials: ${Array.from(missingCredentials.keys()).join(', ')}.`
          );
        }

        const installedMcps: string[] = [];
        const mcpsBaseDir = path.join(cwd, PROFILES_DIR, profileName, 'mcps');

        for (const [name, mcp] of Object.entries(profile.mcps)) {
          if (!(mcp.kind === 'local' && mcp.source === 'bundled')) continue;

          const extractedMcpPath = resolveBundledArchivePath(extractDir, mcp.path);
          const destMcpPath = path.join(mcpsBaseDir, name);

          try {
            await stat(extractedMcpPath);
          } catch {
            throw new ProfileError(
              `Bundled MCP "${name}" source not found in archive.`
            );
          }

          await rm(destMcpPath, { recursive: true, force: true });
          await mkdir(destMcpPath, { recursive: true });
          await cp(extractedMcpPath, destMcpPath, { recursive: true });

          const installCmd = mcp.install;
          if (!installCmd) {
            profile.mcps[name] = {
              ...mcp,
              path: destMcpPath,
            };
            installedMcps.push(name);
            continue;
          }

          try {
            execSync(installCmd, {
              cwd: destMcpPath,
              stdio: 'pipe',
            });
          } catch (error) {
            throw new ProfileError(
              `Bundled MCP "${name}" install failed: ${formatExecError(error)}`
            );
          }

          profile.mcps[name] = {
            ...mcp,
            path: destMcpPath,
          };

          installedMcps.push(name);
        }

        await validateImportedMcps(profile, cwd, mcpPreflightService);

        const installedPlugins: string[] = [];
        for (const plugin of manifest.plugins ?? []) {
          await restorePlugin(extractDir, plugin);
          installedPlugins.push(`${plugin.agent}:${plugin.name}`);
        }

        const installedUserSkills: string[] = [];
        for (const skill of manifest.userSkills ?? []) {
          await restoreUserSkill(extractDir, skill);
          installedUserSkills.push(`${skill.agent}:${skill.name}`);
        }

        const outputYaml: Record<string, unknown> = {
          name: profile.name,
          ...(profile.description ? { description: profile.description } : {}),
          skills: profile.skills,
          mcps: profile.mcps,
          memory: profile.memory,
        };

        await mkdir(path.dirname(profilePath), { recursive: true });
        await writeFile(profilePath, YAML.stringify(outputYaml), 'utf8');

        return { profileName, installedMcps, installedPlugins, installedUserSkills };
      } finally {
        await rm(extractDir, { recursive: true, force: true });
      }
    },
  };
}

async function validateImportedMcps(
  profile: ProfileConfig,
  cwd: string,
  mcpPreflightService: Pick<McpPreflightService, 'execute'>
): Promise<void> {
  for (const [name, mcp] of Object.entries(profile.mcps)) {
    if (mcp.kind === 'remote') {
      validateRemoteMcp(name, mcp);
      continue;
    }

    const validation = await mcpPreflightService.execute({
      cwd: mcp.source === 'bundled' ? mcp.path : cwd,
      agent: 'claude',
      key: name,
      entry: toAgentMcpEntry(mcp),
    });
    const firstError = validation.checks.find((check) => check.status === 'error');
    if (firstError) {
      throw new ProfileError(`Imported MCP "${name}" failed validation: ${firstError.message}`);
    }
  }
}

function toAgentMcpEntry(mcp: Exclude<McpServerConfig, RemoteMcpServerConfig>): {
  command: string;
  args?: string[];
  env?: Record<string, string>;
} {
  if (mcp.source === 'npm') {
    return {
      command: 'npx',
      args: ['-y', mcp.package],
      ...(mcp.env ? { env: mcp.env } : {}),
    };
  }

  return {
    command: mcp.command,
    ...(mcp.args ? { args: mcp.args } : {}),
    ...(mcp.env ? { env: mcp.env } : {}),
  };
}

function validateRemoteMcp(name: string, mcp: RemoteMcpServerConfig): void {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(mcp.url);
  } catch {
    throw new ProfileError(`Remote MCP "${name}" must include an absolute http(s) url.`);
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new ProfileError(`Remote MCP "${name}" must include an absolute http(s) url.`);
  }
}

function formatExecError(error: unknown): string {
  if (error && typeof error === 'object') {
    const stderr = 'stderr' in error && typeof error.stderr === 'string'
      ? error.stderr.trim()
      : 'stderr' in error && Buffer.isBuffer(error.stderr)
        ? error.stderr.toString('utf8').trim()
        : '';
    if (stderr.length > 0) {
      return stderr;
    }

    if ('message' in error && typeof error.message === 'string') {
      return error.message;
    }
  }

  return 'Unknown install error.';
}

async function readPortableManifest(extractDir: string): Promise<PortableProfileManifest> {
  let source: string;
  try {
    source = await readFile(path.join(extractDir, 'manifest.yaml'), 'utf8');
  } catch {
    throw new ProfileError('Portable profile archive is missing manifest.yaml.');
  }

  let parsed: unknown;
  try {
    parsed = YAML.parse(source) ?? {};
  } catch {
    throw new ProfileError('Portable profile manifest has invalid YAML.');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ProfileError('Portable profile manifest has invalid structure.');
  }

  const manifest = parsed as Record<string, unknown>;
  if (manifest.schemaVersion !== 1 && manifest.schemaVersion !== 2) {
    throw new ProfileError(
      `Unsupported portable profile schema version: ${String(manifest.schemaVersion)}.`
    );
  }

  if (typeof manifest.profileName !== 'string' || manifest.profileName.trim().length === 0) {
    throw new ProfileError('Portable profile manifest must include profileName.');
  }

  return manifest as unknown as PortableProfileManifest;
}

function resolveBundledArchivePath(extractDir: string, bundlePath: string): string {
  if (!bundlePath || path.isAbsolute(bundlePath)) {
    throw new ProfileError('Bundled MCP path must be a relative archive path.');
  }

  const resolved = path.resolve(extractDir, bundlePath);
  const relative = path.relative(extractDir, resolved);
  if (
    relative.startsWith(`..${path.sep}`) ||
    relative === '..' ||
    path.isAbsolute(relative)
  ) {
    throw new ProfileError(`Bundled MCP path "${bundlePath}" escapes the archive root.`);
  }

  return resolved;
}

async function restorePlugin(
  extractDir: string,
  plugin: PortablePluginSnapshot
): Promise<void> {
  const sourceDir = resolveBundledArchivePath(extractDir, plugin.archivePath);
  try {
    await stat(sourceDir);
  } catch {
    throw new ProfileError(
      `Bundled plugin "${plugin.name}" source missing in archive at ${plugin.archivePath}.`
    );
  }

  if (plugin.agent === 'gemini') {
    // Gemini has no plugin cache concept. Treat as user-skill-equivalent no-op.
    return;
  }

  const marketplace = plugin.marketplace ?? plugin.source;
  const version = plugin.version ?? 'unknown';
  const cacheRoot = path.join(homedir(), `.${plugin.agent}`, 'plugins', 'cache');
  const targetDir = path.join(cacheRoot, marketplace, plugin.name, version);

  await rm(targetDir, { recursive: true, force: true });
  await mkdir(path.dirname(targetDir), { recursive: true });
  await cp(sourceDir, targetDir, { recursive: true });

  if (plugin.agent === 'claude') {
    await registerClaudePlugin({
      pluginKey: `${plugin.name}@${marketplace}`,
      installPath: targetDir,
      version,
    });
    return;
  }

  if (plugin.agent === 'codex') {
    await registerCodexPlugin({
      pluginKey: `${plugin.name}@${marketplace}`,
    });
  }
}

async function restoreUserSkill(
  extractDir: string,
  skill: PortableUserSkillSnapshot
): Promise<void> {
  const sourceDir = resolveBundledArchivePath(extractDir, skill.archivePath);
  try {
    await stat(sourceDir);
  } catch {
    throw new ProfileError(
      `Bundled user skill "${skill.name}" source missing in archive at ${skill.archivePath}.`
    );
  }

  const targetDir = path.join(homedir(), `.${skill.agent}`, 'skills', skill.name);
  await rm(targetDir, { recursive: true, force: true });
  await mkdir(path.dirname(targetDir), { recursive: true });
  await cp(sourceDir, targetDir, { recursive: true });
}

async function registerClaudePlugin(options: {
  pluginKey: string;
  installPath: string;
  version: string;
}): Promise<void> {
  const filePath = path.join(homedir(), '.claude', 'plugins', 'installed_plugins.json');
  let existing: Record<string, unknown> = { version: 2, plugins: {} };

  try {
    const source = await readFile(filePath, 'utf8');
    existing = JSON.parse(source) as Record<string, unknown>;
    await backupFile(filePath);
  } catch {
    // fresh file
  }

  const plugins = (existing.plugins ?? {}) as Record<string, Array<Record<string, unknown>>>;
  const now = new Date().toISOString();
  const entry = {
    scope: 'user',
    installPath: options.installPath,
    version: options.version,
    installedAt: now,
    lastUpdated: now,
  };
  plugins[options.pluginKey] = [entry];
  existing.plugins = plugins;
  if (typeof existing.version !== 'number') existing.version = 2;

  await mkdir(path.dirname(filePath), { recursive: true });
  await atomicWrite(filePath, JSON.stringify(existing, null, 2) + '\n');
}

async function registerCodexPlugin(options: { pluginKey: string }): Promise<void> {
  const filePath = path.join(homedir(), '.codex', 'config.toml');
  let existing = '';
  try {
    existing = await readFile(filePath, 'utf8');
    await backupFile(filePath);
  } catch {
    existing = '';
  }

  const header = `[plugins."${options.pluginKey}"]`;
  if (existing.includes(header)) return;

  const prefix = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
  const separator = existing.length > 0 ? '\n' : '';
  const block = `${header}\nenabled = true\n`;
  const next = existing + prefix + separator + block;

  await mkdir(path.dirname(filePath), { recursive: true });
  await atomicWrite(filePath, next);
}

async function backupFile(filePath: string): Promise<void> {
  const backupPath = `${filePath}.bak.${formatTimestamp()}`;
  try {
    await copyFile(filePath, backupPath);
  } catch {
    // file may not exist
  }
}

async function atomicWrite(filePath: string, content: string): Promise<void> {
  const tmpPath = `${filePath}.tmp.${Date.now()}`;
  await writeFile(tmpPath, content, 'utf8');
  await rename(tmpPath, filePath);
}
