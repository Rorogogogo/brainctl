export interface RegisterGithubProfileInput {
  repoUrl: string;
  slug: string;
  title: string;
  summary?: string;
  refName?: string;
  profilePath?: string;
  manifestJson: Record<string, unknown>;
}

export interface ProfileInstallDescriptor {
  slug: string;
  version: string;
  source_kind: 'brainctl' | 'github' | string;
  download_url: string;
  checksum_sha256?: string | null;
}

export interface CreateProfileInput {
  slug: string;
  title: string;
  summary?: string;
  visibility?: 'public' | 'private';
}

export interface ProfileResponse {
  id: string;
  slug: string;
  title: string;
  summary: string;
}

export interface CreateProfileVersionInput {
  profileId: string;
  version: string;
  changelog?: string;
  manifestJson: Record<string, unknown>;
}

export interface ProfileVersionResponse {
  id: string;
  profile_id: string;
  version: string;
}

export interface UploadPackageInput {
  profileId: string;
  versionId: string;
  bytes: Uint8Array | Buffer;
  mimeType?: string;
}

export interface PublishProfileVersionInput {
  profileId: string;
  versionId: string;
}

export function createProfileRegistryClient(options: {
  baseUrl: string;
  token?: string;
  fetch?: typeof fetch;
}) {
  const fetchImpl = options.fetch ?? fetch;
  const baseUrl = options.baseUrl.replace(/\/$/, '');
  const jsonHeaders = {
    'content-type': 'application/json',
    ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
  };
  const authOnlyHeaders = {
    ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
  };

  async function failIfNotOk(response: Response, action: string): Promise<void> {
    if (response.ok) return;
    const text = await response.text().catch(() => '');
    throw new Error(
      `${action} failed: HTTP ${response.status}${text ? ` — ${text}` : ''}`
    );
  }

  return {
    async registerGithubProfile(input: RegisterGithubProfileInput) {
      const response = await fetchImpl(`${baseUrl}/profiles/github/register`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({
          repo_url: input.repoUrl,
          slug: input.slug,
          title: input.title,
          summary: input.summary ?? '',
          ref_name: input.refName ?? 'main',
          profile_path: input.profilePath ?? 'profile.yaml',
          manifest_json: input.manifestJson,
        }),
      });
      await failIfNotOk(response, 'Register GitHub profile');
      return response.json();
    },

    async getInstallDescriptor(slug: string): Promise<ProfileInstallDescriptor> {
      const response = await fetchImpl(`${baseUrl}/profiles/${slug}/install`, {
        method: 'GET',
        headers: authOnlyHeaders,
      });
      await failIfNotOk(response, 'Read install descriptor');
      return response.json() as Promise<ProfileInstallDescriptor>;
    },

    async getProfileBySlug(slug: string): Promise<ProfileResponse | null> {
      const response = await fetchImpl(`${baseUrl}/profiles/${slug}`, {
        method: 'GET',
        headers: authOnlyHeaders,
      });
      if (response.status === 404) return null;
      await failIfNotOk(response, 'Lookup profile');
      const data = (await response.json()) as { id: string; slug: string; title: string; summary: string };
      return data;
    },

    async createProfile(input: CreateProfileInput): Promise<ProfileResponse> {
      const response = await fetchImpl(`${baseUrl}/profiles`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({
          slug: input.slug,
          title: input.title,
          summary: input.summary ?? '',
          visibility: input.visibility ?? 'public',
        }),
      });
      await failIfNotOk(response, 'Create profile');
      return response.json() as Promise<ProfileResponse>;
    },

    async createProfileVersion(input: CreateProfileVersionInput): Promise<ProfileVersionResponse> {
      const response = await fetchImpl(
        `${baseUrl}/profiles/${input.profileId}/versions`,
        {
          method: 'POST',
          headers: jsonHeaders,
          body: JSON.stringify({
            version: input.version,
            changelog: input.changelog ?? '',
            manifest_json: input.manifestJson,
          }),
        }
      );
      await failIfNotOk(response, 'Create profile version');
      return response.json() as Promise<ProfileVersionResponse>;
    },

    async uploadPackage(input: UploadPackageInput): Promise<unknown> {
      const response = await fetchImpl(
        `${baseUrl}/profiles/${input.profileId}/versions/${input.versionId}/package`,
        {
          method: 'POST',
          headers: {
            'content-type': input.mimeType ?? 'application/gzip',
            ...authOnlyHeaders,
          },
          body: input.bytes as unknown as BodyInit,
        }
      );
      await failIfNotOk(response, 'Upload package');
      return response.json();
    },

    async publishProfileVersion(input: PublishProfileVersionInput): Promise<unknown> {
      const response = await fetchImpl(
        `${baseUrl}/profiles/${input.profileId}/versions/${input.versionId}/publish`,
        {
          method: 'POST',
          headers: authOnlyHeaders,
        }
      );
      await failIfNotOk(response, 'Publish profile version');
      return response.json();
    },
  };
}
