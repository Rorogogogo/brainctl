import { describe, expect, it } from 'vitest';

import { ProfileError } from '../src/errors.js';
import { parseProfile } from '../src/services/profile-service.js';

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
