import type { IncomingMessage, ServerResponse } from 'node:http';
import { loadConfig } from '../config.js';
import { loadMemory } from '../context/memory.js';
import { createStatusService } from '../services/status-service.js';
import type { StatusService } from '../services/status-service.js';

export interface UiRouteDependencies {
  cwd: string;
  statusService?: StatusService;
}

export type UiRouteHandler = (
  request: IncomingMessage,
  response: ServerResponse
) => Promise<void>;

export function createUiRouteHandler(
  dependencies: UiRouteDependencies
): UiRouteHandler {
  const statusService = dependencies.statusService ?? createStatusService();

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
        return sendJson(response, 404, { error: 'Not found' });
    }
  };
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
