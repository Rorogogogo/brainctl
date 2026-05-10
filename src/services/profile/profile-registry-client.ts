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

export function createProfileRegistryClient(options: {
  baseUrl: string;
  token?: string;
  fetch?: typeof fetch;
}) {
  const fetchImpl = options.fetch ?? fetch;
  const baseUrl = options.baseUrl.replace(/\/$/, '');
  const headers = {
    'content-type': 'application/json',
    ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
  };

  return {
    async registerGithubProfile(input: RegisterGithubProfileInput) {
      const response = await fetchImpl(`${baseUrl}/profiles/github/register`, {
        method: 'POST',
        headers,
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

      if (!response.ok) {
        throw new Error(await response.text());
      }

      return response.json();
    },

    async getInstallDescriptor(slug: string): Promise<ProfileInstallDescriptor> {
      const response = await fetchImpl(`${baseUrl}/profiles/${slug}/install`, {
        method: 'GET',
        headers,
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      return response.json() as Promise<ProfileInstallDescriptor>;
    },
  };
}
