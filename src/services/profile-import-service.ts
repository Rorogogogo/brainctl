import { execSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import YAML from 'yaml';

import { ProfileError } from '../errors.js';
import type { McpServerConfig, PortableProfileManifest, ProfileConfig, RemoteMcpServerConfig } from '../types.js';
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
  }): Promise<{ profileName: string; installedMcps: string[] }>;
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

        const outputYaml: Record<string, unknown> = {
          name: profile.name,
          ...(profile.description ? { description: profile.description } : {}),
          skills: profile.skills,
          mcps: profile.mcps,
          memory: profile.memory,
        };

        await mkdir(path.dirname(profilePath), { recursive: true });
        await writeFile(profilePath, YAML.stringify(outputYaml), 'utf8');

        return { profileName, installedMcps };
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
  if (manifest.schemaVersion !== 1) {
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
