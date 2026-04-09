import path from 'node:path';

import { ValidationError } from '../errors.js';
import type {
  LocalBundledMcpServerConfig,
  LocalNpmMcpServerConfig,
  RemoteMcpServerConfig,
} from '../types.js';
import type { AgentMcpEntry, PortableRemoteMcpMetadata } from './agent-config-service.js';

const LOCAL_SCRIPT_RUNNERS = new Set(['node', 'nodejs']);

export type PortableMcpClassification =
  | LocalNpmMcpServerConfig
  | LocalBundledMcpServerConfig
  | RemoteMcpServerConfig;

export class PortableMcpClassificationError extends ValidationError {}

export function classifyPortableMcp(options: {
  cwd: string;
  key: string;
  entry: AgentMcpEntry;
  remote?: PortableRemoteMcpMetadata;
}): PortableMcpClassification {
  if (options.remote) {
    return classifyRemoteMcp(options.key, options.remote);
  }

  const packageName = resolveNpxPackage(options.entry);
  if (packageName) {
    return {
      kind: 'local',
      source: 'npm',
      package: packageName,
      ...(options.entry.env ? { env: options.entry.env } : {}),
    };
  }

  const bundledPath = resolveBundledPath(options.cwd, options.entry);
  if (bundledPath) {
    return {
      kind: 'local',
      source: 'bundled',
      path: bundledPath,
      command: options.entry.command,
      ...(options.entry.args ? { args: options.entry.args } : {}),
      ...(options.entry.env ? { env: options.entry.env } : {}),
    };
  }

  throw new PortableMcpClassificationError(
    `MCP "${options.key}" cannot be packed from the live agent config because it is neither an explicit remote MCP nor a local npx/bundled entry.`
  );
}

function classifyRemoteMcp(
  key: string,
  remote: PortableRemoteMcpMetadata
): RemoteMcpServerConfig {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(remote.url);
  } catch {
    throw new PortableMcpClassificationError(
      `Remote MCP "${key}" must include an absolute http(s) url.`
    );
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new PortableMcpClassificationError(
      `Remote MCP "${key}" must include an absolute http(s) url.`
    );
  }

  if (remote.transport !== 'http' && remote.transport !== 'sse') {
    throw new PortableMcpClassificationError(
      `Remote MCP "${key}" must use transport "http" or "sse".`
    );
  }

  return {
    kind: 'remote',
    transport: remote.transport,
    url: remote.url,
    ...(remote.headers ? { headers: remote.headers } : {}),
    ...(remote.env ? { env: remote.env } : {}),
  };
}

function resolveNpxPackage(entry: AgentMcpEntry): string | null {
  if (entry.command !== 'npx') {
    return null;
  }

  const packageName = resolveDeclaredNpxPackage(entry.args ?? []);
  if (!packageName) {
    throw new PortableMcpClassificationError(
      'npx-based MCP entries must include a package or executable argument.'
    );
  }

  return packageName;
}

function resolveBundledPath(cwd: string, entry: AgentMcpEntry): string | null {
  if (!LOCAL_SCRIPT_RUNNERS.has(entry.command)) {
    return null;
  }

  const firstArg = entry.args?.[0];
  if (!firstArg || !looksLikeLocalPath(firstArg)) {
    return null;
  }

  return resolveProjectLocalPath(cwd, path.dirname(firstArg));
}

function resolveDeclaredNpxPackage(args: string[]): string | null {
  let packageName: string | null = null;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--package') {
      const nextArg = args[index + 1];
      if (nextArg && !nextArg.startsWith('-')) {
        return nextArg;
      }
      continue;
    }

    if (arg.startsWith('--package=')) {
      const declaredPackage = arg.slice('--package='.length).trim();
      if (declaredPackage.length > 0) {
        return declaredPackage;
      }
      continue;
    }

    if (arg.startsWith('-')) {
      continue;
    }

    if (!packageName) {
      packageName = arg;
    }
  }

  return packageName;
}

function looksLikeLocalPath(value: string): boolean {
  return (
    value.startsWith('.') ||
    value.startsWith('/') ||
    value.includes(path.sep)
  );
}

function resolveProjectLocalPath(cwd: string, candidate: string): string | null {
  const resolved = path.resolve(cwd, candidate);
  const relative = path.relative(cwd, resolved);
  if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
    return null;
  }

  return resolved;
}
