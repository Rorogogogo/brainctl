import type {
  McpServerConfig,
  PortableCredentialPlaceholder,
  PortableCredentialSpec,
} from '../types.js';

export interface CredentialRedactionResult<T extends McpServerConfig> {
  redacted: T;
  credentials: PortableCredentialSpec[];
}

export function redactPortableMcpCredentials<T extends McpServerConfig>(
  config: T
): CredentialRedactionResult<T> {
  const credentialsByKey = new Map<string, CredentialAccumulator>();
  const redactedEnv = redactStringMap(config.env, 'env', credentialsByKey);

  if (config.kind === 'remote') {
    const redactedHeaders = redactStringMap(config.headers, 'header', credentialsByKey);
    return {
      redacted: {
        ...config,
        ...(redactedEnv ? { env: redactedEnv } : {}),
        ...(redactedHeaders ? { headers: redactedHeaders } : {}),
      },
      credentials: finalizePortableCredentialSpecs(credentialsByKey),
    };
  }

  return {
    redacted: {
      ...config,
      ...(redactedEnv ? { env: redactedEnv } : {}),
    },
    credentials: finalizePortableCredentialSpecs(credentialsByKey),
  };
}

function redactStringMap(
  values: Record<string, string> | undefined,
  source: 'env' | 'header',
  credentialsByKey: Map<string, CredentialAccumulator>
): Record<string, string> | undefined {
  if (!values) {
    return undefined;
  }

  const redacted: Record<string, string> = {};

  for (const [key, value] of Object.entries(values)) {
    if (!shouldRedact(key)) {
      redacted[key] = value;
      continue;
    }

    const credentialKey = normalizeCredentialKey(key);
    addCredentialSpec(credentialsByKey, credentialKey, source, key);
    redacted[key] = isCredentialPlaceholder(value)
      ? value
      : `\${credentials.${credentialKey}}` as PortableCredentialPlaceholder;
  }

  return redacted;
}

function shouldRedact(key: string): boolean {
  const tokens = tokenizeCredentialKey(key);
  if (tokens.length === 0) {
    return false;
  }

  return (
    tokens[tokens.length - 1] === 'authorization' ||
    tokens[tokens.length - 1] === 'password' ||
    tokens[tokens.length - 1] === 'secret' ||
    tokens[tokens.length - 1] === 'token' ||
    (tokens[tokens.length - 1] === 'key' &&
      (tokens.includes('api') || (tokens.includes('auth') && tokens.includes('key'))))
  );
}

function normalizeCredentialKey(key: string): string {
  return tokenizeCredentialKey(key).join('_');
}

function tokenizeCredentialKey(key: string): string[] {
  return key
    .trim()
    .replace(/([A-Z]+)([A-Z][a-z0-9])/g, '$1 $2')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter(Boolean);
}

function isCredentialPlaceholder(value: string): boolean {
  return /^\$\{credentials\.[^}]+\}$/.test(value) || /^(Bearer|Token)\s+\$\{credentials\.[^}]+\}$/i.test(value);
}

function addCredentialSpec(
  credentialsByKey: Map<string, CredentialAccumulator>,
  credentialKey: string,
  source: 'env' | 'header',
  originalKey: string
): void {
  const description = source === 'env' ? `Environment variable ${originalKey}` : `Header ${originalKey}`;
  const existing = credentialsByKey.get(credentialKey);
  if (existing) {
    existing.descriptions.add(description);
    return;
  }

  credentialsByKey.set(credentialKey, {
    key: credentialKey,
    required: true,
    descriptions: new Set([description]),
  });
}

interface CredentialAccumulator {
  key: string;
  required: true;
  descriptions: Set<string>;
}

export function finalizePortableCredentialSpecs(
  credentialsByKey: Map<string, CredentialAccumulator>
): PortableCredentialSpec[] {
  return Array.from(credentialsByKey.values())
    .sort((left, right) => left.key.localeCompare(right.key))
    .map((entry) => ({
      key: entry.key,
      required: entry.required,
      description: `${Array.from(entry.descriptions).sort().join('; ')} required for MCP access`,
    }));
}
