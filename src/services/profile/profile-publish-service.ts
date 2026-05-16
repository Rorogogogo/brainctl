import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import YAML from 'yaml';

import {
  createProfileRegistryClient,
  type ProfileResponse,
} from './profile-registry-client.js';
import type { ProfileExportService } from './profile-export-service.js';
import { brainctlHome, createProfileService, type ProfileService } from './profile-service.js';
import {
  createAgentConfigService,
  type AgentConfigService,
} from '../agent/agent-config-service.js';

export interface ProfilePublishInput {
  cwd: string;
  profileName: string;
  slug: string;
  title: string;
  summary?: string;
  version?: string;
  changelog?: string;
  visibility?: 'public' | 'private';
  apiBaseUrl: string;
  token?: string;
  fetch?: typeof fetch;
  onProgress?: (message: string) => void;
}

export interface ProfilePublishResult {
  slug: string;
  profileId: string;
  versionId: string;
  version: string;
}

export interface ProfilePublishService {
  execute(input: ProfilePublishInput): Promise<ProfilePublishResult>;
}

interface ProfilePublishDependencies {
  profileExportService: ProfileExportService;
  registryClientFactory?: typeof createProfileRegistryClient;
  profileService?: ProfileService;
  agentConfigService?: AgentConfigService;
}

export function createProfilePublishService(
  deps: ProfilePublishDependencies
): ProfilePublishService {
  const factory = deps.registryClientFactory ?? createProfileRegistryClient;
  const profileService = deps.profileService ?? createProfileService();
  const agentConfigService = deps.agentConfigService ?? createAgentConfigService();

  return {
    async execute(input) {
      const progress = input.onProgress ?? (() => {});
      const version = input.version ?? '1.0.0';

      const client = factory({
        baseUrl: input.apiBaseUrl,
        token: input.token,
        fetch: input.fetch,
      });

      const tmpRoot = await mkdtemp(path.join(tmpdir(), 'brainctl-publish-'));
      const archivePath = path.join(tmpRoot, `${input.profileName}.tar.gz`);
      try {
        progress(`Exporting profile "${input.profileName}"…`);
        const exportResult = await deps.profileExportService.execute({
          cwd: input.cwd,
          source: { source: 'profile', name: input.profileName },
          outputPath: archivePath,
          onProgress: progress,
        });

        progress('Reading package…');
        const bytes = await readFile(exportResult.archivePath);

        progress(`Resolving registry profile "${input.slug}"…`);
        let profile: ProfileResponse | null = await client.getProfileBySlug(input.slug);
        if (!profile) {
          progress('Creating registry profile…');
          profile = await client.createProfile({
            slug: input.slug,
            title: input.title,
            summary: input.summary,
            visibility: input.visibility,
          });
        }

        progress('Capturing profile inventory…');
        const manifestJson = await buildPublishManifest({
          slug: input.slug,
          version,
          cwd: input.cwd,
          profileName: input.profileName,
          profileService,
          agentConfigService,
        });

        progress(`Creating version ${version}…`);
        const profileVersion = await client.createProfileVersion({
          profileId: profile.id,
          version,
          changelog: input.changelog,
          manifestJson,
        });

        progress('Uploading package…');
        await client.uploadPackage({
          profileId: profile.id,
          versionId: profileVersion.id,
          bytes,
          mimeType: 'application/gzip',
        });

        progress('Publishing version…');
        await client.publishProfileVersion({
          profileId: profile.id,
          versionId: profileVersion.id,
        });

        try {
          const sidecarDir = path.join(
            brainctlHome(),
            '.brainctl',
            'profiles',
            input.profileName
          );
          await mkdir(sidecarDir, { recursive: true });
          await writeFile(
            path.join(sidecarDir, 'published.yaml'),
            YAML.stringify({
              slug: input.slug,
              title: input.title,
              profileId: profile.id,
              versionId: profileVersion.id,
              version,
              apiBaseUrl: input.apiBaseUrl,
              lastPublishedAt: new Date().toISOString(),
            }),
            'utf8'
          );
        } catch {
          // non-fatal: sidecar is a UI hint, publish itself already succeeded
        }

        progress('Done.');
        return {
          slug: input.slug,
          profileId: profile.id,
          versionId: profileVersion.id,
          version,
        };
      } finally {
        await rm(tmpRoot, { recursive: true, force: true });
      }
    },
  };
}

type PublishManifest = Record<string, unknown> & {
  name: string;
  version: string;
  description?: string;
  mcps: Array<{ name: string; kind: 'local' | 'remote' }>;
  skills: Array<{ agent: string; name: string; source?: string }>;
  plugins: Array<{
    agent: string;
    name: string;
    source?: string;
    skills?: string[];
    mcps?: string[];
    agents?: string[];
    commands?: string[];
  }>;
};

async function buildPublishManifest(args: {
  slug: string;
  version: string;
  cwd: string;
  profileName: string;
  profileService: ProfileService;
  agentConfigService: AgentConfigService;
}): Promise<PublishManifest> {
  const manifest: PublishManifest = {
    name: args.slug,
    version: args.version,
    mcps: [],
    skills: [],
    plugins: [],
  };

  try {
    const profile = await args.profileService.get({
      cwd: args.cwd,
      name: args.profileName,
    });
    if (profile.description) {
      manifest.description = profile.description;
    }
    manifest.mcps = Object.entries(profile.mcps).map(([name, entry]) => ({
      name,
      kind: entry.kind,
    }));
  } catch {
    // profile read failed; manifest stays empty for mcps
  }

  try {
    const configs = await args.agentConfigService.readAll({ cwd: args.cwd });
    for (const config of configs) {
      if (!config.exists) continue;
      for (const skill of config.skills) {
        if (skill.kind === 'plugin') {
          manifest.plugins.push({
            agent: config.agent,
            name: skill.name,
            ...(skill.source ? { source: skill.source } : {}),
            ...(skill.pluginSkills && skill.pluginSkills.length > 0
              ? { skills: skill.pluginSkills }
              : {}),
            ...(skill.pluginMcps && skill.pluginMcps.length > 0
              ? { mcps: skill.pluginMcps }
              : {}),
            ...(skill.pluginAgents && skill.pluginAgents.length > 0
              ? { agents: skill.pluginAgents }
              : {}),
            ...(skill.pluginCommands && skill.pluginCommands.length > 0
              ? { commands: skill.pluginCommands }
              : {}),
          });
        } else {
          manifest.skills.push({
            agent: config.agent,
            name: skill.name,
            ...(skill.source ? { source: skill.source } : {}),
          });
        }
      }
    }
  } catch {
    // agent read failed; skills/plugins stay empty
  }

  return manifest;
}
