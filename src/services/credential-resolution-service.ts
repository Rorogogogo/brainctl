import type {
  McpServerConfig,
  PortableCredentialPlaceholder,
  PortableCredentialSpec,
} from '../types.js';

export interface CredentialResolutionResult<T extends McpServerConfig> {
  resolved: T;
  missing: PortableCredentialSpec[];
}

export function resolvePortableMcpCredentials<T extends McpServerConfig>(
  config: T,
  options: {
    credentials?: Record<string, string>;
    credentialSpecs?: PortableCredentialSpec[];
    environment?: Record<string, string | undefined>;
  } = {}
): CredentialResolutionResult<T> {
  const specs = new Map((options.credentialSpecs ?? []).map((spec) => [spec.key, spec]));
  const missing = new Map<string, PortableCredentialSpec>();
  const env = resolveStringMap(config.env, specs, missing, options.credentials, options.environment);

  if (config.kind === 'remote') {
    const headers = resolveStringMap(
      config.headers,
      specs,
      missing,
      options.credentials,
      options.environment
    );

    return {
      resolved: {
        ...config,
        ...(env ? { env } : {}),
        ...(headers ? { headers } : {}),
      },
      missing: Array.from(missing.values()),
    };
  }

  return {
    resolved: {
      ...config,
      ...(env ? { env } : {}),
    },
    missing: Array.from(missing.values()),
  };
}

function resolveStringMap(
  values: Record<string, string> | undefined,
  specs: Map<string, PortableCredentialSpec>,
  missing: Map<string, PortableCredentialSpec>,
  credentials?: Record<string, string>,
  environment?: Record<string, string | undefined>
): Record<string, string> | undefined {
  if (!values) {
    return undefined;
  }

  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    const placeholder = parseCredentialPlaceholder(value);
    if (!placeholder) {
      resolved[key] = value;
      continue;
    }

    const resolvedValue = credentials?.[placeholder.key] ?? environment?.[placeholder.key];
    if (typeof resolvedValue === 'string' && resolvedValue.length > 0) {
      resolved[key] = placeholder.prefix ? `${placeholder.prefix} ${resolvedValue}` : resolvedValue;
      continue;
    }

    const spec = specs.get(placeholder.key) ?? {
      key: placeholder.key,
      required: true,
      description: `Credential ${placeholder.key} is required`,
    };
    if (spec.required) {
      missing.set(spec.key, spec);
    }
    resolved[key] = value;
  }

  return resolved;
}

function parseCredentialPlaceholder(
  value: string
): { key: string; prefix?: 'Bearer' | 'Token' } | null {
  const bareMatch = value.match(/^\$\{credentials\.([^}]+)\}$/);
  if (bareMatch) {
    return { key: bareMatch[1] };
  }

  const prefixedMatch = value.match(/^(Bearer|Token)\s+\$\{credentials\.([^}]+)\}$/i);
  if (prefixedMatch) {
    const prefix = prefixedMatch[1].toLowerCase() === 'bearer' ? 'Bearer' : 'Token';
    return {
      key: prefixedMatch[2],
      prefix,
    };
  }

  return null;
}

export function toPortableCredentialPlaceholder(key: string): PortableCredentialPlaceholder {
  return `\${credentials.${key}}`;
}
