import { describe, expect, it } from 'vitest';

import { resolvePortableMcpCredentials } from '../src/services/credential-resolution-service.js';

describe('resolvePortableMcpCredentials', () => {
  it('resolves bare credential placeholders from explicit credential input', () => {
    const result = resolvePortableMcpCredentials(
      {
        kind: 'local',
        source: 'npm',
        package: '@modelcontextprotocol/server-github',
        env: {
          GITHUB_TOKEN: '${credentials.github_token}',
        },
      },
      {
        credentials: {
          github_token: 'ghp_live_secret',
        },
        credentialSpecs: [
          {
            key: 'github_token',
            required: true,
          },
        ],
      }
    );

    expect(result.resolved.env).toEqual({
      GITHUB_TOKEN: 'ghp_live_secret',
    });
    expect(result.missing).toEqual([]);
  });

  it('resolves bearer placeholders from environment fallback', () => {
    const result = resolvePortableMcpCredentials(
      {
        kind: 'remote',
        transport: 'http',
        url: 'https://mcp.example.com',
        headers: {
          Authorization: 'Bearer ${credentials.internal_api_key}',
        },
      },
      {
        environment: {
          internal_api_key: 'super-secret-token',
        },
        credentialSpecs: [
          {
            key: 'internal_api_key',
            required: true,
          },
        ],
      }
    );

    expect(result.resolved.headers).toEqual({
      Authorization: 'Bearer super-secret-token',
    });
    expect(result.missing).toEqual([]);
  });

  it('reports missing required credentials without crashing', () => {
    const result = resolvePortableMcpCredentials(
      {
        kind: 'local',
        source: 'bundled',
        path: './mcps/custom',
        command: 'node',
        env: {
          DB_PASSWORD: '${credentials.db_password}',
        },
      },
      {
        credentialSpecs: [
          {
            key: 'db_password',
            required: true,
          },
        ],
      }
    );

    expect(result.resolved.env).toEqual({
      DB_PASSWORD: '${credentials.db_password}',
    });
    expect(result.missing).toEqual([
      {
        key: 'db_password',
        required: true,
      },
    ]);
  });

  it('leaves optional unresolved placeholders intact without marking them missing', () => {
    const result = resolvePortableMcpCredentials(
      {
        kind: 'remote',
        transport: 'http',
        url: 'https://mcp.example.com',
        headers: {
          Authorization: 'Bearer ${credentials.optional_token}',
        },
      },
      {
        credentialSpecs: [
          {
            key: 'optional_token',
            required: false,
          },
        ],
      }
    );

    expect(result.resolved.headers).toEqual({
      Authorization: 'Bearer ${credentials.optional_token}',
    });
    expect(result.missing).toEqual([]);
  });
});
