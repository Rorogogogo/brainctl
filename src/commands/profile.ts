import pc from 'picocolors';
import type { Command } from 'commander';

import type { ProfileApplyService, ItemSelector } from '../services/profile/profile-apply-service.js';
import type { ProfileExportService } from '../services/profile/profile-export-service.js';
import type { ProfileImportService } from '../services/profile/profile-import-service.js';
import type { ProfileService } from '../services/profile/profile-service.js';
import type { ProfileSnapshotService } from '../services/profile/profile-snapshot-service.js';
import { createProfileRegistryClient } from '../services/profile/profile-registry-client.js';
import { resolveBrainctlApiBaseUrl } from '../services/platform/brainctl-config-service.js';
import type { AgentName } from '../types.js';

const ALL_AGENTS: AgentName[] = ['claude', 'codex', 'gemini'];

export interface ProfileCommandServices {
  profileService: ProfileService;
  profileExportService: ProfileExportService;
  profileImportService: ProfileImportService;
  profileApplyService: ProfileApplyService;
  profileSnapshotService: ProfileSnapshotService;
}

export function registerProfileCommand(program: Command, services: ProfileCommandServices): void {
  const {
    profileService,
    profileExportService,
    profileImportService,
    profileApplyService,
    profileSnapshotService,
  } = services;
  const profileCmd = program
    .command('profile')
    .description('Manage brainctl profiles');

  profileCmd
    .command('list')
    .description('List available profiles')
    .action(async () => {
      const { profiles } = await profileService.list({ cwd: process.cwd() });

      if (profiles.length === 0) {
        console.log('No profiles found. Run "brainctl profile create <name>" to create one.');
        return;
      }

      console.log(pc.bold('Profiles:'));
      for (const name of profiles) {
        console.log(`  ${name}`);
      }
    });

  profileCmd
    .command('create')
    .argument('<name>', 'Profile name')
    .option('-d, --description <text>', 'Profile description')
    .description('Create a new profile')
    .action(async (name: string, options: { description?: string }) => {
      const result = await profileService.create({
        cwd: process.cwd(),
        name,
        description: options.description,
      });
      console.log(`Created profile at ${result.profilePath}`);
    });

  profileCmd
    .command('export')
    .argument('[name]', 'Profile name to export')
    .option('-a, --agent <name>', 'Pack a live agent config instead (claude, codex, gemini)')
    .option('-o, --output <path>', 'Output file or directory path')
    .option('-f, --format <format>', 'Output format: tarball (default) or folder', 'tarball')
    .option(
      '--credentials <mode>',
      'How to handle secrets: redact (default, public-safe) or keep (writes .env with real values for self-sync)',
      'redact'
    )
    .description('Export a profile as a portable tarball or folder')
    .action(
      async (
        name: string | undefined,
        options: { agent?: string; output?: string; format?: string; credentials?: string }
      ) => {
        const agent =
          options.agent === 'claude' || options.agent === 'codex' || options.agent === 'gemini'
            ? options.agent
            : undefined;
        if (!agent && !name) {
          throw new Error('Provide a profile name or --agent <name>.');
        }

        if (options.format && options.format !== 'tarball' && options.format !== 'folder') {
          throw new Error(`Invalid --format "${options.format}". Use "tarball" or "folder".`);
        }

        if (
          options.credentials &&
          options.credentials !== 'redact' &&
          options.credentials !== 'keep'
        ) {
          throw new Error(
            `Invalid --credentials "${options.credentials}". Use "redact" or "keep".`
          );
        }

        const result = await profileExportService.execute({
          cwd: process.cwd(),
          source: agent
            ? { source: 'agent', agent, cwd: process.cwd() }
            : { source: 'profile', name: name as string },
          outputPath: options.output,
          format: (options.format as 'tarball' | 'folder' | undefined) ?? 'tarball',
          credentialsMode: (options.credentials as 'redact' | 'keep' | undefined) ?? 'redact',
        });
        for (const warning of result.warnings) {
          console.warn(pc.yellow(`warning: ${warning}`));
        }
        const label = result.format === 'folder' ? 'profile folder' : 'profile tarball';
        console.log(`Exported ${label} to ${result.archivePath}`);
      }
    );

  profileCmd
    .command('import')
    .argument('<archive>', 'Path to profile tarball')
    .option('--force', 'Overwrite existing profile', false)
    .option('-c, --credential <key=value>', 'Provide a credential value for import', collectCredentialOption, [])
    .description('Import a profile from a tarball')
    .action(async (archive: string, options: { force: boolean; credential: string[] }) => {
      const result = await profileImportService.execute({
        cwd: process.cwd(),
        archivePath: archive,
        force: options.force,
        credentials: toCredentialMap(options.credential),
      });

      console.log(`Imported profile "${result.profileName}"`);
      if (result.installedMcps.length > 0) {
        console.log(`Installed bundled MCPs: ${result.installedMcps.join(', ')}`);
      }
    });

  profileCmd
    .command('apply')
    .argument('<name>', 'Profile name to apply')
    .option(
      '-a, --agent <list>',
      'Comma-separated agents to target (claude, codex, gemini, or all)',
      'all'
    )
    .option(
      '-i, --items <list>',
      'Comma-separated items to apply (e.g. mcp:github,plugin:demo,skill:reviewer). Default: everything matching.'
    )
    .option('--no-backup', 'Skip auto-backup of live agent state before applying')
    .option(
      '--replace',
      'DESTRUCTIVE: uninstall live plugins/skills not present in the profile so the agent matches it exactly. Default: additive apply.',
      false
    )
    .description('Apply a profile (MCPs + plugins + skills) to selected agents')
    .action(
      async (
        name: string,
        options: { agent: string; items?: string; backup: boolean; replace: boolean }
      ) => {
        const agents = parseAgentList(options.agent);
        const items = options.items ? parseItemList(options.items) : undefined;

        const { backups, applied } = await profileApplyService.execute({
          cwd: process.cwd(),
          profileName: name,
          agents,
          items,
          backup: options.backup,
          replace: options.replace,
        });

        if (backups.length > 0) {
          console.log(pc.bold('Backups:'));
          for (const b of backups) {
            console.log(`  ${b.agent} -> ${b.profileName}`);
          }
        }

        console.log(pc.bold(`Applied "${name}" to:`));
        for (const r of applied) {
          const extras: string[] = [`${r.mcpCount} MCPs`];
          if (r.pluginsInstalled?.length) extras.push(`plugins: ${r.pluginsInstalled.join(',')}`);
          if (r.userSkillsInstalled?.length) extras.push(`skills: ${r.userSkillsInstalled.join(',')}`);
          console.log(`  ${r.agent}: ${extras.join(' | ')}`);
        }
      }
    );

  profileCmd
    .command('register-github')
    .argument('<repo-url>', 'GitHub repository URL')
    .requiredOption('--slug <slug>', 'Registry slug')
    .requiredOption('--title <title>', 'Profile title')
    .option('--summary <text>', 'Profile summary')
    .option('--ref <name>', 'GitHub ref', 'main')
    .option('--profile-path <path>', 'Profile path in repository', 'profile.yaml')
    .option('--api-base-url <url>', 'Brainctl platform API base URL')
    .description('Register a GitHub-hosted profile with brainctl.net')
    .action(
      async (
        repoUrl: string,
        options: {
          slug: string;
          title: string;
          summary?: string;
          ref: string;
          profilePath: string;
          apiBaseUrl?: string;
        }
      ) => {
        const token = process.env.BRAINCTL_API_TOKEN;
        if (!token) {
          throw new Error('BRAINCTL_API_TOKEN is required to register a profile.');
        }

        const client = createProfileRegistryClient({
          baseUrl: await registryApiUrl(options.apiBaseUrl),
          token,
        });
        await client.registerGithubProfile({
          repoUrl,
          slug: options.slug,
          title: options.title,
          summary: options.summary,
          refName: options.ref,
          profilePath: options.profilePath,
          manifestJson: { name: options.slug },
        });

        console.log(`Registered GitHub profile "${options.slug}"`);
      }
    );

  profileCmd
    .command('install')
    .argument('<slug>', 'Registry profile slug')
    .option('--api-base-url <url>', 'Brainctl platform API base URL')
    .description('Read the install descriptor for a registry profile')
    .action(async (slug: string, options: { apiBaseUrl?: string }) => {
      const client = createProfileRegistryClient({
        baseUrl: await registryApiUrl(options.apiBaseUrl),
        token: process.env.BRAINCTL_API_TOKEN,
      });
      const descriptor = await client.getInstallDescriptor(slug);

      console.log(`Install descriptor: ${descriptor.source_kind}`);
      console.log(`  version: ${descriptor.version}`);
      console.log(`  download: ${descriptor.download_url}`);
    });

  profileCmd
    .command('snapshot')
    .option('-a, --agent <name>', 'Agent to snapshot (claude, codex, gemini)')
    .option('--as <name>', 'Profile name to write into (default: backup-<agent>-<timestamp>)')
    .description("Snapshot a live agent's MCPs+plugins+skills into a new profile folder")
    .action(async (options: { agent?: string; as?: string }) => {
      if (!options.agent || !ALL_AGENTS.includes(options.agent as AgentName)) {
        throw new Error('Provide --agent <claude|codex|gemini>.');
      }
      const agent = options.agent as AgentName;
      const { defaultBackupProfileName } = await import(
        '../services/profile/profile-snapshot-service.js'
      );
      const profileName = options.as ?? defaultBackupProfileName(agent);
      const result = await profileSnapshotService.execute({
        cwd: process.cwd(),
        agent,
        profileName,
        onProgress: (message) => {
          console.error(message);
        },
      });
      console.log(`Snapshotted ${agent} into ${result.profilePath}`);
    });
}

function registryApiUrl(apiBaseUrl?: string): Promise<string> {
  return resolveBrainctlApiBaseUrl({ apiBaseUrl });
}

function parseAgentList(value: string): AgentName[] {
  if (value === 'all') return [...ALL_AGENTS];
  const parts = value.split(',').map((s) => s.trim()).filter(Boolean);
  for (const p of parts) {
    if (!ALL_AGENTS.includes(p as AgentName)) {
      throw new Error(`Invalid agent "${p}". Use claude, codex, gemini, or all.`);
    }
  }
  return parts as AgentName[];
}

function parseItemList(value: string): ItemSelector[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const colonIdx = entry.indexOf(':');
      if (colonIdx <= 0) {
        throw new Error(`Invalid item "${entry}". Use type:name (e.g. mcp:github).`);
      }
      const type = entry.slice(0, colonIdx);
      const name = entry.slice(colonIdx + 1);
      if (type !== 'mcp' && type !== 'plugin' && type !== 'skill') {
        throw new Error(`Invalid item type "${type}". Use mcp, plugin, or skill.`);
      }
      if (!name) throw new Error(`Item "${entry}" missing name.`);
      return { type, name };
    });
}

function collectCredentialOption(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function toCredentialMap(values: string[]): Record<string, string> | undefined {
  if (values.length === 0) {
    return undefined;
  }

  const credentials: Record<string, string> = {};
  for (const value of values) {
    const separatorIndex = value.indexOf('=');
    if (separatorIndex <= 0 || separatorIndex === value.length - 1) {
      throw new Error(`Invalid credential "${value}". Use key=value.`);
    }

    const key = value.slice(0, separatorIndex).trim();
    const credentialValue = value.slice(separatorIndex + 1).trim();
    if (!key || !credentialValue) {
      throw new Error(`Invalid credential "${value}". Use key=value.`);
    }

    credentials[key] = credentialValue;
  }

  return credentials;
}
