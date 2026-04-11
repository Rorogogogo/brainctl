import path from 'node:path';

import { ValidationError } from '../errors.js';
import type {
  LocalBundledMcpServerConfig,
  LocalNpmMcpServerConfig,
  McpRuntime,
  RemoteMcpServerConfig,
} from '../types.js';
import type { AgentMcpEntry, PortableRemoteMcpMetadata } from './agent-config-service.js';
import { detectMcpRuntime, extractEntrypoint } from './runtime-detector.js';

const NPX_LIKE_COMMANDS = new Set(['npx', 'uvx']);

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

  const runtime = detectMcpRuntime(options.entry.command);
  if (runtime) {
    return classifyBundledMcp(options.cwd, options.key, options.entry, runtime);
  }

  throw new PortableMcpClassificationError(
    `MCP "${options.key}" cannot be packed: unrecognized command "${options.entry.command}".`
  );
}

function classifyBundledMcp(
  cwd: string,
  key: string,
  entry: AgentMcpEntry,
  runtime: McpRuntime
): LocalBundledMcpServerConfig {
  const entrypoint = extractEntrypoint(entry.command, entry.args ?? []);

  let bundlePath: string;
  if (runtime === 'rust') {
    bundlePath = cwd;
  } else if (entrypoint) {
    const resolvedEntrypoint = path.resolve(cwd, entrypoint);
    const entrypointDir = path.dirname(resolvedEntrypoint);
    bundlePath = resolveProjectLocalPath(cwd, entrypointDir, key);
  } else {
    throw new PortableMcpClassificationError(
      `MCP "${key}" cannot be packed: could not determine entrypoint from args.`
    );
  }

  return {
    kind: 'local',
    source: 'bundled',
    runtime,
    path: bundlePath,
    command: entry.command,
    ...(entry.args ? { args: entry.args } : {}),
    ...(entry.env ? { env: entry.env } : {}),
  };
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
  if (!NPX_LIKE_COMMANDS.has(entry.command)) {
    return null;
  }

  const packageName = resolveDeclaredNpxPackage(entry.args ?? []);
  if (!packageName) {
    throw new PortableMcpClassificationError(
      'npx/uvx-based MCP entries must include a package or executable argument.'
    );
  }

  return packageName;
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

function resolveProjectLocalPath(cwd: string, candidate: string, key: string): string {
  const resolved = path.resolve(cwd, candidate);
  const relative = path.relative(cwd, resolved);
  if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
    throw new PortableMcpClassificationError(
      `MCP "${key}" cannot be packed: path "${candidate}" is outside the project directory.`
    );
  }

  return resolved;
}
