import { describe, expect, it } from 'vitest';

import { createProfileRegistryClient } from '../../src/services/profile/profile-registry-client.js';

describe('profile registry client', () => {
  it('registers a github profile through the hosted API', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = createProfileRegistryClient({
      baseUrl: 'https://api.brainctl.net',
      token: 'token',
      fetch: async (url, init) => {
        calls.push({ url: String(url), init });
        return new Response(JSON.stringify({ slug: 'review-profile' }), { status: 200 });
      },
    });

    await client.registerGithubProfile({
      repoUrl: 'https://github.com/acme/review-profile',
      slug: 'review-profile',
      title: 'Review Profile',
      manifestJson: { name: 'review-profile' },
    });

    expect(calls[0]?.url).toBe('https://api.brainctl.net/profiles/github/register');
    expect(calls[0]?.init?.method).toBe('POST');
    expect(calls[0]?.init?.headers).toMatchObject({
      authorization: 'Bearer token',
    });
  });
});
