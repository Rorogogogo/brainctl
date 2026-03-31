import type { IncomingMessage, ServerResponse } from 'node:http';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { loadConfig } from '../config.js';
import { parseConfigPayload } from '../config.js';
import { ConfigError, ProfileError, ProfileNotFoundError } from '../errors.js';
import { loadMemory } from '../context/memory.js';
import { createAgentConfigService } from '../services/agent-config-service.js';
import type { AgentMcpEntry } from '../services/agent-config-service.js';
import { createConfigWriteService } from '../services/config-write-service.js';
import { createProfileService } from '../services/profile-service.js';
import { createRunService } from '../services/run-service.js';
import type { RunService } from '../services/run-service.js';
import { createStatusService } from '../services/status-service.js';
import type { StatusService } from '../services/status-service.js';
import { createSyncService } from '../services/sync-service.js';
import { startSseStream, writeSseEvent } from './streaming.js';
import type { AgentName, RunRequest } from '../types.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface UiRouteDependencies {
  cwd: string;
  statusService?: StatusService;
  runService?: RunService;
}

export type UiRouteHandler = (
  request: IncomingMessage,
  response: ServerResponse
) => Promise<void>;

const uiAssetRoot = resolveUiAssetRoot();

export function createUiRouteHandler(
  dependencies: UiRouteDependencies
): UiRouteHandler {
  const statusService = dependencies.statusService ?? createStatusService();
  const runService = dependencies.runService ?? createRunService();
  const configWriteService = createConfigWriteService();
  const profileService = createProfileService();
  const syncService = createSyncService({ profileService });
  const agentConfigService = createAgentConfigService();

  return async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');

    switch (url.pathname) {
      case '/api/overview': {
        if (request.method !== 'GET') {
          return sendJson(response, 405, { error: 'Method not allowed' });
        }

        const overview = await statusService.execute({ cwd: dependencies.cwd });
        return sendJson(response, 200, overview);
      }
      case '/api/run/stream': {
        if (request.method !== 'GET') {
          return sendJson(response, 405, { error: 'Method not allowed' });
        }

        const runRequest = parseRunRequest(url);
        if (runRequest === null) {
          return sendJson(response, 400, {
            error: 'Missing skill, inputFile, or primaryAgent'
          });
        }

        if ('error' in runRequest) {
          return sendJson(response, 400, {
            error: runRequest.error
          });
        }

        startSseStream(response);

        try {
          const trace = await runService.execute(
            {
              ...runRequest.request,
              cwd: dependencies.cwd
            },
            {
              onOutputChunk: (chunk) => {
                writeSseEvent(response, 'output', chunk);
              },
              streamOutput: false
            }
          );

          writeSseEvent(response, 'result', trace);
          response.end();
        } catch (error) {
          writeSseEvent(response, 'run-error', {
            error: error instanceof Error ? error.message : 'Unexpected server error'
          });
          response.end();
        }

        return;
      }
      case '/api/config': {
        if (request.method === 'PUT') {
          const body = await readJsonBody(request);
          if (!body.ok) {
            return sendJson(response, 400, { error: 'Invalid JSON body' });
          }

          const config = parseConfigPayload(body.value);

          await configWriteService.execute({
            cwd: dependencies.cwd,
            config
          });

          const savedConfig = await loadConfig({ cwd: dependencies.cwd });
          return sendJson(response, 200, savedConfig);
        }

        if (request.method !== 'GET') {
          return sendJson(response, 405, { error: 'Method not allowed' });
        }

        const config = await loadConfig({ cwd: dependencies.cwd });
        return sendJson(response, 200, config);
      }
      case '/api/memory': {
        if (request.method !== 'GET') {
          return sendJson(response, 405, { error: 'Method not allowed' });
        }

        const config = await loadConfig({ cwd: dependencies.cwd });
        const memory = await loadMemory({ paths: config.memory.paths });
        return sendJson(response, 200, memory);
      }
      case '/api/agents': {
        if (request.method !== 'GET') {
          return sendJson(response, 405, { error: 'Method not allowed' });
        }

        const overview = await statusService.execute({ cwd: dependencies.cwd });
        return sendJson(response, 200, overview.agents);
      }
      case '/api/agents/live': {
        if (request.method !== 'GET') {
          return sendJson(response, 405, { error: 'Method not allowed' });
        }

        const configs = await agentConfigService.readAll({ cwd: dependencies.cwd });
        return sendJson(response, 200, configs);
      }
      case '/api/profiles': {
        if (request.method === 'GET') {
          const result = await profileService.list({ cwd: dependencies.cwd });
          return sendJson(response, 200, result);
        }

        if (request.method === 'POST') {
          const body = await readJsonBody(request);
          if (!body.ok) {
            return sendJson(response, 400, { error: 'Invalid JSON body' });
          }

          const data = body.value as Record<string, unknown>;
          try {
            const result = await profileService.create({
              cwd: dependencies.cwd,
              name: String(data.name ?? ''),
              description: typeof data.description === 'string' ? data.description : undefined,
            });
            return sendJson(response, 201, result);
          } catch (error) {
            return sendProfileError(response, error);
          }
        }

        return sendJson(response, 405, { error: 'Method not allowed' });
      }
      case '/api/sync': {
        if (request.method !== 'POST') {
          return sendJson(response, 405, { error: 'Method not allowed' });
        }

        try {
          const result = await syncService.execute({ cwd: dependencies.cwd });
          return sendJson(response, 200, result);
        } catch (error) {
          return sendJson(response, 500, {
            error: error instanceof Error ? error.message : 'Sync failed',
          });
        }
      }
      default: {
        // Agent MCP routes: /api/agents/:name/mcps(/:key)
        const agentMcpMatch = url.pathname.match(/^\/api\/agents\/(claude|codex|gemini)\/mcps(?:\/(.+))?$/);
        if (agentMcpMatch) {
          const agentName = agentMcpMatch[1] as AgentName;
          const mcpKey = agentMcpMatch[2] ? decodeURIComponent(agentMcpMatch[2]) : null;

          if (request.method === 'POST' && !mcpKey) {
            const body = await readJsonBody(request);
            if (!body.ok) {
              return sendJson(response, 400, { error: 'Invalid JSON body' });
            }
            const data = body.value as { key?: string; entry?: AgentMcpEntry };
            if (!data.key || !data.entry?.command) {
              return sendJson(response, 400, { error: 'Missing key or entry.command' });
            }
            try {
              await agentConfigService.addMcp({
                cwd: dependencies.cwd,
                agent: agentName,
                key: data.key,
                entry: data.entry,
              });
              return sendJson(response, 200, { ok: true });
            } catch (error) {
              return sendJson(response, 500, {
                error: error instanceof Error ? error.message : 'Failed to add MCP',
              });
            }
          }

          if (request.method === 'DELETE' && mcpKey) {
            try {
              await agentConfigService.removeMcp({
                cwd: dependencies.cwd,
                agent: agentName,
                key: mcpKey,
              });
              return sendJson(response, 200, { ok: true });
            } catch (error) {
              return sendJson(response, 500, {
                error: error instanceof Error ? error.message : 'Failed to remove MCP',
              });
            }
          }

          return sendJson(response, 405, { error: 'Method not allowed' });
        }

        const profileMatch = url.pathname.match(/^\/api\/profiles\/([^/]+)(\/activate)?$/);
        if (profileMatch) {
          const name = decodeURIComponent(profileMatch[1]);
          const isActivate = profileMatch[2] === '/activate';

          if (isActivate) {
            if (request.method !== 'POST') {
              return sendJson(response, 405, { error: 'Method not allowed' });
            }
            try {
              const result = await profileService.use({ cwd: dependencies.cwd, name });
              return sendJson(response, 200, result);
            } catch (error) {
              return sendProfileError(response, error);
            }
          }

          if (request.method === 'GET') {
            try {
              const profile = await profileService.get({ cwd: dependencies.cwd, name });
              return sendJson(response, 200, profile);
            } catch (error) {
              return sendProfileError(response, error);
            }
          }

          if (request.method === 'PUT') {
            const body = await readJsonBody(request);
            if (!body.ok) {
              return sendJson(response, 400, { error: 'Invalid JSON body' });
            }
            try {
              await profileService.update({
                cwd: dependencies.cwd,
                name,
                config: body.value as import('../types.js').ProfileConfig,
              });
              return sendJson(response, 200, { ok: true });
            } catch (error) {
              return sendProfileError(response, error);
            }
          }

          if (request.method === 'DELETE') {
            try {
              await profileService.delete({ cwd: dependencies.cwd, name });
              return sendJson(response, 200, { ok: true });
            } catch (error) {
              return sendProfileError(response, error);
            }
          }

          return sendJson(response, 405, { error: 'Method not allowed' });
        }

        if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
          return sendJson(response, 404, { error: 'Not found' });
        }

        if (request.method !== 'GET') {
          return sendJson(response, 405, { error: 'Method not allowed' });
        }

        return serveUiResponse(url.pathname, response);
      }
    }
  };
}

async function readJsonBody(
  request: IncomingMessage
): Promise<{ ok: true; value: unknown } | { ok: false }> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const rawBody = Buffer.concat(chunks).toString('utf8').trim();

  if (rawBody.length === 0) {
    return { ok: false };
  }

  try {
    return { ok: true, value: JSON.parse(rawBody) as unknown };
  } catch {
    return { ok: false };
  }
}

function parseRunRequest(url: URL):
  | { request: RunRequest }
  | { error: string }
  | null {
  const skill = url.searchParams.get('skill');
  const inputFile = url.searchParams.get('inputFile');
  const primaryAgent = parseAgentName(url.searchParams.get('primaryAgent'));
  const fallbackAgentParam = url.searchParams.get('fallbackAgent');
  const fallbackAgent =
    fallbackAgentParam === null ? null : parseAgentName(fallbackAgentParam);

  if (!skill || !inputFile || !primaryAgent || fallbackAgentParam !== null && !fallbackAgent) {
    return null;
  }

  if (fallbackAgent !== null && fallbackAgent === primaryAgent) {
    return { error: 'fallbackAgent must differ from primaryAgent' };
  }

  return {
    request: {
      skill,
      inputFile,
      primaryAgent,
      fallbackAgent: fallbackAgent ?? undefined
    }
  };
}

function parseAgentName(value: string | null): AgentName | null {
  if (value === 'claude' || value === 'codex') {
    return value;
  }

  return null;
}

function sendProfileError(response: ServerResponse, error: unknown): void {
  if (error instanceof ProfileNotFoundError) {
    return sendJson(response, 404, { error: error.message });
  }
  if (error instanceof ProfileError) {
    return sendJson(response, 400, { error: error.message });
  }
  return sendJson(response, 500, {
    error: error instanceof Error ? error.message : 'Internal server error',
  });
}

function sendJson(
  response: ServerResponse,
  statusCode: number,
  body: unknown
): void {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(body));
}

async function serveUiResponse(pathname: string, response: ServerResponse): Promise<void> {
  if (!uiAssetRoot) {
    return sendNotFound(response);
  }

  if (pathname === '/' || pathname === '/index.html') {
    return sendAsset(response, path.join(uiAssetRoot, 'index.html'), 'text/html; charset=utf-8');
  }

  const isAssetPath = pathname.startsWith('/assets/') || path.extname(pathname).length > 0;
  if (isAssetPath) {
    const assetPath = path.resolve(uiAssetRoot, `.${pathname}`);
    if (!isWithinDirectory(uiAssetRoot, assetPath) || !existsSync(assetPath)) {
      return sendNotFound(response);
    }

    return sendAsset(response, assetPath, getContentType(assetPath));
  }

  return sendAsset(response, path.join(uiAssetRoot, 'index.html'), 'text/html; charset=utf-8');
}

async function sendAsset(
  response: ServerResponse,
  filePath: string,
  contentType: string
): Promise<void> {
  const body = await readFile(filePath);
  response.statusCode = 200;
  response.setHeader('Content-Type', contentType);
  response.end(body);
}

function sendNotFound(response: ServerResponse): void {
  response.statusCode = 404;
  response.setHeader('Content-Type', 'text/plain; charset=utf-8');
  response.end('Not found');
}

function getContentType(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.js':
      return 'text/javascript; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.ico':
      return 'image/x-icon';
    case '.png':
      return 'image/png';
    case '.map':
      return 'application/json; charset=utf-8';
    default:
      return 'application/octet-stream';
  }
}

function isWithinDirectory(parentDirectory: string, targetPath: string): boolean {
  const relativePath = path.relative(parentDirectory, targetPath);

  if (relativePath === '') {
    return true;
  }

  return !relativePath.startsWith(`..${path.sep}`) && relativePath !== '..' && !path.isAbsolute(relativePath);
}

function resolveUiAssetRoot(): string | null {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(moduleDir, '../web'),
    path.resolve(moduleDir, '../../dist/web'),
    path.resolve(process.cwd(), 'dist/web')
  ];

  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, 'index.html'))) {
      return candidate;
    }
  }

  return null;
}
