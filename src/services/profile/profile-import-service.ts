import { execSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import YAML from 'yaml';

import { ProfileError } from '../../errors.js';
import type {
  McpServerConfig,
  PortableProfileManifest,
  ProfileConfig,
  RemoteMcpServerConfig,
} from '../../types.js';
import { installPlugin, installUserSkill } from '../agent/agent-asset-installer.js';
import { resolvePortableMcpCredentials } from '../credential/credential-resolution-service.js';
import { createMcpPreflightService, type McpPreflightService } from '../platform/mcp-preflight-service.js';
import { normalizePortableProfileManifest } from './profile-manifest-normalizer.js';
import { brainctlHome, parseProfile } from './profile-service.js';

function profilesRoot(_cwd: string): string {
  return path.join(brainctlHome(), '.brainctl', 'profiles');
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

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

      let archiveStats;
      try {
        archiveStats = await stat(archivePath);
      } catch {
        throw new ProfileError(`Archive not found: ${archivePath}`);
      }

      const isFolderSource = archiveStats.isDirectory();
      const extractDir = isFolderSource
        ? archivePath
        : await mkdtemp(path.join(tmpdir(), 'brainctl-import-'));

      try {
        if (!isFolderSource) {
          execSync(`tar -xzf "${archivePath}" -C "${extractDir}"`, {
            stdio: 'pipe',
          });
        }

        const manifest = normalizePortableProfileManifest(await readPortableManifest(extractDir));
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

        const profileFolder = path.join(profilesRoot(cwd), profileName);
        const profilePath = path.join(profileFolder, 'profile.yaml');
        const legacyProfilePath = path.join(profilesRoot(cwd), `${profileName}.yaml`);
        if (!options.force) {
          if ((await pathExists(profilePath)) || (await pathExists(legacyProfilePath))) {
            throw new ProfileError(
              `Profile "${profileName}" already exists. Use --force to overwrite.`
            );
          }
        } else {
          // clean up legacy single-file profile so it doesn't shadow the new layout
          if (await pathExists(legacyProfilePath)) {
            await rm(legacyProfilePath, { force: true });
          }
        }

        const dotEnvCreds = await readDotEnvCredentials(extractDir);
        const combinedCreds = { ...dotEnvCreds, ...(options.credentials ?? {}) };

        const missingCredentials = new Map<string, string>();
        for (const [name, mcp] of Object.entries(profile.mcps)) {
          const resolution = resolvePortableMcpCredentials(mcp, {
            credentials: combinedCreds,
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
        const mcpsBaseDir = path.join(profilesRoot(cwd), profileName, 'mcps');

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
          const sourceDir = resolveBundledArchivePath(extractDir, plugin.archivePath);
          const profileLocalDir = path.join(profilesRoot(cwd), profileName, plugin.archivePath);
          await rm(profileLocalDir, { recursive: true, force: true });
          await mkdir(path.dirname(profileLocalDir), { recursive: true });
          await cp(sourceDir, profileLocalDir, { recursive: true });
          await installPlugin(profileLocalDir, plugin);
          installedPlugins.push(`${plugin.agent}:${plugin.name}`);
        }

        const installedUserSkills: string[] = [];
        for (const skill of manifest.userSkills ?? []) {
          const sourceDir = resolveBundledArchivePath(extractDir, skill.archivePath);
          const profileLocalDir = path.join(profilesRoot(cwd), profileName, skill.archivePath);
          await rm(profileLocalDir, { recursive: true, force: true });
          await mkdir(path.dirname(profileLocalDir), { recursive: true });
          await cp(sourceDir, profileLocalDir, { recursive: true });
          await installUserSkill(profileLocalDir, skill);
          installedUserSkills.push(`${skill.agent}:${skill.name}`);
        }

        // retain manifest in profile folder so sync can reapply assets
        try {
          await mkdir(path.join(profilesRoot(cwd), profileName), { recursive: true });
          await writeFile(
            path.join(profilesRoot(cwd), profileName, 'manifest.yaml'),
            YAML.stringify(manifest),
            'utf8'
          );
        } catch {
          // best-effort
        }

        const outputYaml: Record<string, unknown> = {
          name: profile.name,
          ...(profile.description ? { description: profile.description } : {}),
          mcps: profile.mcps,
        };

        await mkdir(path.dirname(profilePath), { recursive: true });
        await writeFile(profilePath, YAML.stringify(outputYaml), 'utf8');

        return { profileName, installedMcps, installedPlugins, installedUserSkills };
      } finally {
        if (!isFolderSource) {
          await rm(extractDir, { recursive: true, force: true });
        }
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

async function readDotEnvCredentials(extractDir: string): Promise<Record<string, string>> {
  try {
    const content = await readFile(path.join(extractDir, '.env'), 'utf8');
    const out: Record<string, string> = {};
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
      }
      out[key.toLowerCase()] = value;
    }
    return out;
  } catch {
    return {};
  }
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
  if (manifest.schemaVersion !== 1 && manifest.schemaVersion !== 2 && manifest.schemaVersion !== 3) {
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
