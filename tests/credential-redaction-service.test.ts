import { describe, expect, it } from 'vitest';

import { redactPortableMcpCredentials } from '../src/services/credential-redaction-service.js';

describe('redactPortableMcpCredentials', () => {
  it('redacts likely secret env values into credential placeholders', () => {
    const result = redactPortableMcpCredentials({
      kind: 'local',
      source: 'npm',
      package: '@modelcontextprotocol/server-github',
      env: {
        GITHUB_TOKEN: 'ghp_live_secret',
        OPENAI_API_KEY: 'sk-live-secret',
        apiKey: 'plain-camel-case',
        authToken: 'plain-camel-case',
        dbPassword: 'plain-camel-case',
        LOG_LEVEL: 'debug',
      },
    });

    expect(result.redacted.env).toEqual({
      GITHUB_TOKEN: '${credentials.github_token}',
      OPENAI_API_KEY: '${credentials.openai_api_key}',
      apiKey: '${credentials.api_key}',
      authToken: '${credentials.auth_token}',
      dbPassword: '${credentials.db_password}',
      LOG_LEVEL: 'debug',
    });
    expect(result.credentials).toEqual([
      {
        key: 'api_key',
        required: true,
        description: 'Environment variable apiKey required for MCP access',
      },
      {
        key: 'auth_token',
        required: true,
        description: 'Environment variable authToken required for MCP access',
      },
      {
        key: 'db_password',
        required: true,
        description: 'Environment variable dbPassword required for MCP access',
      },
      {
        key: 'github_token',
        required: true,
        description: 'Environment variable GITHUB_TOKEN required for MCP access',
      },
      {
        key: 'openai_api_key',
        required: true,
        description: 'Environment variable OPENAI_API_KEY required for MCP access',
      },
    ]);
  });

  it('redacts authorization headers into bare credential placeholders', () => {
    const result = redactPortableMcpCredentials({
      kind: 'remote',
      transport: 'http',
      url: 'https://mcp.example.com',
      headers: {
        Authorization: 'Bearer super-secret-token',
      },
    });

    expect(result.redacted.headers).toEqual({
      Authorization: '${credentials.authorization}',
    });
    expect(result.credentials).toContainEqual({
      key: 'authorization',
      required: true,
      description: expect.stringContaining('Authorization'),
    });
  });

  it('redacts camelCase header tokens using the shared tokenization rules', () => {
    const result = redactPortableMcpCredentials({
      kind: 'remote',
      transport: 'http',
      url: 'https://mcp.example.com',
      headers: {
        authToken: 'super-secret',
      },
    });

    expect(result.redacted.headers).toEqual({
      authToken: '${credentials.auth_token}',
    });
    expect(result.credentials).toEqual([
      {
        key: 'auth_token',
        required: true,
        description: 'Header authToken required for MCP access',
      },
    ]);
  });

  it('redacts api key style headers without changing non-secret headers', () => {
    const result = redactPortableMcpCredentials({
      kind: 'remote',
      transport: 'http',
      url: 'https://mcp.example.com',
      headers: {
        'X-API-Key': 'abc123',
        Accept: 'application/json',
      },
    });

    expect(result.redacted.headers).toEqual({
      'X-API-Key': '${credentials.x_api_key}',
      Accept: 'application/json',
    });
    expect(result.credentials).toContainEqual({
      key: 'x_api_key',
      required: true,
      description: expect.stringContaining('X-API-Key'),
    });
  });

  it('preserves existing credential placeholders', () => {
    const result = redactPortableMcpCredentials({
      kind: 'local',
      source: 'bundled',
      path: './mcps/custom',
      command: 'node',
      env: {
        OPENAI_API_KEY: '${credentials.openai_api_key}',
      },
    });

    expect(result.redacted.env).toEqual({
      OPENAI_API_KEY: '${credentials.openai_api_key}',
    });
    expect(result.credentials).toEqual([
      {
        key: 'openai_api_key',
        required: true,
        description: 'Environment variable OPENAI_API_KEY required for MCP access',
      },
    ]);
  });

  it('preserves already-placeholderized bearer values', () => {
    const result = redactPortableMcpCredentials({
      kind: 'remote',
      transport: 'http',
      url: 'https://mcp.example.com',
      headers: {
        Authorization: 'Bearer ${credentials.github_token}',
      },
    });

    expect(result.redacted.headers).toEqual({
      Authorization: 'Bearer ${credentials.github_token}',
    });
    expect(result.credentials).toEqual([
      {
        key: 'authorization',
        required: true,
        description: 'Header Authorization required for MCP access',
      },
    ]);
  });

  it.each([
    ['Token ${credentials.github_token}'],
    ['bearer ${credentials.github_token}'],
  ])('preserves already-placeholderized auth value %s', (authorizationValue) => {
    const result = redactPortableMcpCredentials({
      kind: 'remote',
      transport: 'http',
      url: 'https://mcp.example.com',
      headers: {
        Authorization: authorizationValue,
      },
    });

    expect(result.redacted.headers).toEqual({
      Authorization: authorizationValue,
    });
    expect(result.credentials).toEqual([
      {
        key: 'authorization',
        required: true,
        description: 'Header Authorization required for MCP access',
      },
    ]);
  });

  it('redacts password-style bundled env keys', () => {
    const result = redactPortableMcpCredentials({
      kind: 'local',
      source: 'bundled',
      path: './mcps/custom',
      command: 'node',
      env: {
        PASSWORD: 'super-secret-password',
        DB_PASSWORD: 'super-secret-password',
      },
    });

    expect(result.redacted.env).toEqual({
      PASSWORD: '${credentials.password}',
      DB_PASSWORD: '${credentials.db_password}',
    });
    expect(result.credentials).toContainEqual({
      key: 'password',
      required: true,
      description: 'Environment variable PASSWORD required for MCP access',
    });
    expect(result.credentials).toContainEqual({
      key: 'db_password',
      required: true,
      description: 'Environment variable DB_PASSWORD required for MCP access',
    });
  });

  it('merges colliding credential metadata deterministically', () => {
    const result = redactPortableMcpCredentials({
      kind: 'remote',
      transport: 'http',
      url: 'https://mcp.example.com',
      env: {
        AUTHORIZATION: 'bearer env-token',
      },
      headers: {
        Authorization: 'Bearer header-token',
      },
    });

    expect(result.redacted.env).toEqual({
      AUTHORIZATION: '${credentials.authorization}',
    });
    expect(result.redacted.headers).toEqual({
      Authorization: '${credentials.authorization}',
    });
    expect(result.credentials).toEqual([
      {
        key: 'authorization',
        required: true,
        description:
          'Environment variable AUTHORIZATION; Header Authorization required for MCP access',
      },
    ]);
  });

  it.each([
    ['APIKey', 'api_key'],
    ['DBPassword', 'db_password'],
    ['XApiKey', 'x_api_key'],
  ])('redacts acronym-style env key %s', (key, expectedCredentialKey) => {
    const result = redactPortableMcpCredentials({
      kind: 'local',
      source: 'npm',
      package: '@modelcontextprotocol/server-github',
      env: {
        [key]: 'secret-value',
      },
    });

    expect(result.redacted.env).toEqual({
      [key]: `\${credentials.${expectedCredentialKey}}`,
    });
    expect(result.credentials).toEqual([
      {
        key: expectedCredentialKey,
        required: true,
        description: `Environment variable ${key} required for MCP access`,
      },
    ]);
  });

  it.each([
    ['TOKENIZER_MODEL', 'brainctl'],
    ['SECRETARY_EMAIL', 'team@example.com'],
    ['PASSWORDLESS_LOGIN', 'enabled'],
    ['TOKEN_ENDPOINT', 'https://example.com/token'],
    ['PASSWORD_POLICY', 'required'],
    ['SECRET_ROTATION_ENABLED', 'true'],
    ['AUTHOR_NAME', 'brainctl'],
  ])('does not redact benign env key %s', (key, value) => {
    const result = redactPortableMcpCredentials({
      kind: 'local',
      source: 'npm',
      package: '@modelcontextprotocol/server-github',
      env: {
        [key]: value,
      },
    });

    expect(result.redacted.env).toEqual({
      [key]: value,
    });
    expect(result.credentials).toEqual([]);
  });
});
