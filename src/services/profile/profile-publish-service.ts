import { readFile } from 'node:fs/promises';

import {
  createProfileRegistryClient,
  type ProfileResponse,
} from './profile-registry-client.js';
import type { ProfileExportService } from './profile-export-service.js';

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
  archivePath: string;
}

export interface ProfilePublishService {
  execute(input: ProfilePublishInput): Promise<ProfilePublishResult>;
}

interface ProfilePublishDependencies {
  profileExportService: ProfileExportService;
  registryClientFactory?: typeof createProfileRegistryClient;
}

export function createProfilePublishService(
  deps: ProfilePublishDependencies
): ProfilePublishService {
  const factory = deps.registryClientFactory ?? createProfileRegistryClient;

  return {
    async execute(input) {
      const progress = input.onProgress ?? (() => {});
      const version = input.version ?? '1.0.0';

      const client = factory({
        baseUrl: input.apiBaseUrl,
        token: input.token,
        fetch: input.fetch,
      });

      progress(`Exporting profile "${input.profileName}"…`);
      const exportResult = await deps.profileExportService.execute({
        cwd: input.cwd,
        source: { source: 'profile', name: input.profileName },
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

      progress(`Creating version ${version}…`);
      const profileVersion = await client.createProfileVersion({
        profileId: profile.id,
        version,
        changelog: input.changelog,
        manifestJson: { name: input.slug, version },
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

      progress('Done.');
      return {
        slug: input.slug,
        profileId: profile.id,
        versionId: profileVersion.id,
        version,
        archivePath: exportResult.archivePath,
      };
    },
  };
}
