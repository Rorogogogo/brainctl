import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { ProfileError } from '../../src/errors.js';
import { createProfileService, parseProfile } from '../../src/services/profile/profile-service.js';

describe('parseProfile', () => {
  it('parses profiles with explicit local and remote MCP definitions', () => {
    const profile = parseProfile(
      [
        'name: team-profile',
        'skills:',
        '  summarize:',
        '    prompt: Summarize the document.',
        'mcps:',
        '  github:',
        '    kind: local',
        '    source: npm',
        '    package: "@modelcontextprotocol/server-github"',
        '  docs:',
        '    kind: remote',
        '    transport: http',
        '    url: "https://mcp.example.com"',
        'memory:',
        '  paths:',
        '    - ./memory',
      ].join('\n'),
      'team-profile'
    );

    expect(profile.mcps).toEqual({
      github: {
        kind: 'local',
        source: 'npm',
        package: '@modelcontextprotocol/server-github',
      },
      docs: {
        kind: 'remote',
        transport: 'http',
        url: 'https://mcp.example.com',
      },
    });
  });

  it('accepts legacy local MCP definitions and normalizes them to the packed format', () => {
    const profile = parseProfile(
      [
        'name: team-profile',
        'skills:',
        '  summarize:',
        '    prompt: Summarize the document.',
        'mcps:',
        '  github:',
        '    type: npm',
        '    package: "@modelcontextprotocol/server-github"',
        'memory:',
        '  paths:',
        '    - ./memory',
      ].join('\n'),
      'team-profile'
    );

    expect(profile.mcps).toEqual({
      github: {
        kind: 'local',
        source: 'npm',
        package: '@modelcontextprotocol/server-github',
      },
    });
  });

  it('rejects remote MCP entries without transport and url metadata', () => {
    expect(() =>
      parseProfile(
        [
          'name: team-profile',
          'skills:',
          '  summarize:',
          '    prompt: Summarize the document.',
          'mcps:',
          '  docs:',
          '    kind: remote',
          'memory:',
          '  paths:',
          '    - ./memory',
        ].join('\n'),
        'team-profile'
      )
    ).toThrowError(
      new ProfileError(
        'Remote MCP "docs" must include transport ("http" or "sse") and a url.'
      )
    );
  });
});

describe('createProfileService', () => {
  it('lists profiles from newest to oldest by profile update time', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'brainctl-profile-list-'));
    const originalBrainctlHome = process.env.BRAINCTL_HOME;
    process.env.BRAINCTL_HOME = root;

    try {
      const profilesRoot = path.join(root, '.brainctl', 'profiles');
      const olderFile = path.join(profilesRoot, 'alpha', 'profile.yaml');
      const newerFile = path.join(profilesRoot, 'zulu', 'profile.yaml');
      await mkdir(path.dirname(olderFile), { recursive: true });
      await mkdir(path.dirname(newerFile), { recursive: true });
      await writeFile(olderFile, 'name: alpha\nmcps: {}\n', 'utf8');
      await writeFile(newerFile, 'name: zulu\nmcps: {}\n', 'utf8');

      const older = new Date('2024-01-01T00:00:00Z');
      const newer = new Date('2024-01-02T00:00:00Z');
      await utimes(olderFile, older, older);
      await utimes(newerFile, newer, newer);

      await expect(createProfileService().list({ cwd: root })).resolves.toEqual({
        profiles: ['zulu', 'alpha'],
      });
    } finally {
      if (originalBrainctlHome === undefined) delete process.env.BRAINCTL_HOME;
      else process.env.BRAINCTL_HOME = originalBrainctlHome;
      await rm(root, { recursive: true, force: true });
    }
  });
});
