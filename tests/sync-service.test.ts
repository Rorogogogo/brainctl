import { describe, expect, it } from 'vitest';

import { ProfileError } from '../src/errors.js';
import { createSyncService } from '../src/services/sync-service.js';
import type { ProfileService } from '../src/services/profile-service.js';
import type { AgentConfigWriter } from '../src/services/sync/agent-writer.js';

describe('createSyncService', () => {
  it('rejects profiles that include remote MCP servers', async () => {
    const profileService: ProfileService = {
      async list() {
        return { profiles: ['team-profile'], activeProfile: 'team-profile' };
      },
      async get() {
        return {
          name: 'team-profile',
          skills: {
            summarize: {
              prompt: 'Summarize the document.',
            },
          },
          mcps: {
            docs: {
              kind: 'remote',
              transport: 'http',
              url: 'https://mcp.example.com',
            },
          },
          memory: {
            paths: ['./memory'],
          },
        };
      },
      async create() {
        return { profilePath: '/tmp/team-profile.yaml' };
      },
      async update() {},
      async delete() {},
      async use() {
        return { previousProfile: null };
      },
      async getMetaConfig() {
        return {
          active_profile: 'team-profile',
          agents: ['claude'],
        };
      },
    };

    const writer: AgentConfigWriter = {
      async write() {
        return {
          configPath: '/tmp/config',
          backedUpTo: null,
        };
      },
      async restore() {
        return {
          restoredFrom: '/tmp/config.bak',
        };
      },
    };

    const service = createSyncService({
      profileService,
      writers: {
        claude: writer,
      },
    });

    await expect(service.execute({ cwd: '/tmp/project' })).rejects.toThrowError(
      new ProfileError(
        'Profile "team-profile" includes remote MCP "docs". Remote MCP sync is not supported yet.'
      )
    );
  });
});
