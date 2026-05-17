import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createProfileRegistryClient } from './profile-registry-client.js';
import {
  createProfileImportService,
  type ProfileImportService,
} from './profile-import-service.js';

export interface ProfileRegistryInstallResult {
  profileName: string;
  installedMcps: string[];
  installedPlugins: string[];
  installedUserSkills: string[];
  requiredCredentials: Array<{ key: string; description?: string }>;
  version: string;
  sourceKind: string;
}

export interface ProfileRegistryInstallOptions {
  slug: string;
  apiBaseUrl: string;
  token?: string;
  cwd?: string;
  force?: boolean;
  credentials?: Record<string, string>;
}

export interface ProfileRegistryInstallService {
  execute(options: ProfileRegistryInstallOptions): Promise<ProfileRegistryInstallResult>;
}

interface ProfileRegistryInstallDependencies {
  profileImportService?: ProfileImportService;
  fetch?: typeof fetch;
}

export function createProfileRegistryInstallService(
  deps: ProfileRegistryInstallDependencies = {}
): ProfileRegistryInstallService {
  const profileImportService = deps.profileImportService ?? createProfileImportService();
  const fetchImpl = deps.fetch ?? fetch;

  return {
    async execute(options) {
      const slug = options.slug.trim();
      if (!slug) {
        throw new Error('Registry slug is required.');
      }

      const client = createProfileRegistryClient({
        baseUrl: options.apiBaseUrl,
        token: options.token,
        fetch: fetchImpl,
      });

      const descriptor = await client.getInstallDescriptor(slug);
      if (!descriptor.download_url) {
        throw new Error(`Registry profile "${slug}" has no downloadable package.`);
      }

      const response = await fetchImpl(descriptor.download_url, { method: 'GET' });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(
          `Download failed: HTTP ${response.status}${text ? ` — ${text}` : ''}`
        );
      }
      const bytes = new Uint8Array(await response.arrayBuffer());

      const dir = await mkdtemp(path.join(tmpdir(), 'brainctl-install-'));
      const archivePath = path.join(dir, `${slug}-${descriptor.version}.tar.gz`);
      try {
        await writeFile(archivePath, bytes);
        const result = await profileImportService.execute({
          cwd: options.cwd,
          archivePath,
          force: options.force,
          credentials: options.credentials,
        });
        return {
          ...result,
          version: descriptor.version,
          sourceKind: descriptor.source_kind,
        };
      } finally {
        await rm(dir, { recursive: true, force: true }).catch(() => {});
      }
    },
  };
}
