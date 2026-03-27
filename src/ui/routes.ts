import type { IncomingMessage, ServerResponse } from 'node:http';
import { loadConfig } from '../config.js';
import { loadMemory } from '../context/memory.js';
import { createRunService } from '../services/run-service.js';
import type { RunService } from '../services/run-service.js';
import { createStatusService } from '../services/status-service.js';
import type { StatusService } from '../services/status-service.js';
import { startSseStream, writeSseEvent } from './streaming.js';
import type { AgentName, RunRequest } from '../types.js';

export interface UiRouteDependencies {
  cwd: string;
  statusService?: StatusService;
  runService?: RunService;
}

export type UiRouteHandler = (
  request: IncomingMessage,
  response: ServerResponse
) => Promise<void>;

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

        startSseStream(response);

        try {
          const trace = await runService.execute(
            {
              ...runRequest,
              cwd: dependencies.cwd
            },
            {
              onOutputChunk: (chunk) => {
                writeSseEvent(response, 'output', chunk);
              }
            }
          );

          writeSseEvent(response, 'result', trace);
          response.end();
        } catch (error) {
          writeSseEvent(response, 'error', {
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
        return sendJson(response, 404, { error: 'Not found' });
    }
  };
}

function parseRunRequest(url: URL):
  | RunRequest
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

  return {
    skill,
    inputFile,
    primaryAgent,
    fallbackAgent: fallbackAgent ?? undefined
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
