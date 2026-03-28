import type { IncomingMessage, ServerResponse } from 'node:http';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { loadConfig } from '../config.js';
import { loadMemory } from '../context/memory.js';
import { createRunService } from '../services/run-service.js';
import type { RunService } from '../services/run-service.js';
import { createStatusService } from '../services/status-service.js';
import type { StatusService } from '../services/status-service.js';
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

  return async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');

    if (request.method !== 'GET') {
      return sendJson(response, 405, { error: 'Method not allowed' });
    }

    switch (url.pathname) {
      case '/api/overview': {
        const overview = await statusService.execute({ cwd: dependencies.cwd });
        return sendJson(response, 200, overview);
      }
      case '/api/run/stream': {
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
        const config = await loadConfig({ cwd: dependencies.cwd });
        return sendJson(response, 200, config);
      }
      case '/api/memory': {
        const config = await loadConfig({ cwd: dependencies.cwd });
        const memory = await loadMemory({ paths: config.memory.paths });
        return sendJson(response, 200, memory);
      }
      case '/api/agents': {
        const overview = await statusService.execute({ cwd: dependencies.cwd });
        return sendJson(response, 200, overview.agents);
      }
      default:
        if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
          return sendJson(response, 404, { error: 'Not found' });
        }

        return serveUiResponse(url.pathname, response);
    }
  };
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
