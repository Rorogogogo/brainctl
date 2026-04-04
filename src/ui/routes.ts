import type { IncomingMessage, ServerResponse } from 'node:http';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { loadConfig } from '../config.js';
import { parseConfigPayload } from '../config.js';
import { BrainctlError, ConfigError, ProfileError, ProfileNotFoundError, ValidationError } from '../errors.js';
import { loadMemory } from '../context/memory.js';
import { createAgentConfigService } from '../services/agent-config-service.js';
import type { AgentMcpEntry, AgentSkillEntry } from '../services/agent-config-service.js';
import { createConfigWriteService } from '../services/config-write-service.js';
import { createMcpPreflightService } from '../services/mcp-preflight-service.js';
import { createPluginInstallService } from '../services/plugin-install-service.js';
import { createProfileExportService } from '../services/profile-export-service.js';
import { createProfileImportService } from '../services/profile-import-service.js';
import { createProfileService } from '../services/profile-service.js';
import { createRunService } from '../services/run-service.js';
import type { RunService } from '../services/run-service.js';
import { createSkillPreflightService } from '../services/skill-preflight-service.js';
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
  const profileExportService = createProfileExportService({ profileService });
  const profileImportService = createProfileImportService();
  const syncService = createSyncService({ profileService });
  const agentConfigService = createAgentConfigService();
  const mcpPreflightService = createMcpPreflightService();
  const pluginInstallService = createPluginInstallService();
  const skillPreflightService = createSkillPreflightService();

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
      case '/api/profiles/export': {
        if (request.method !== 'POST') {
          return sendJson(response, 405, { error: 'Method not allowed' });
        }

        const body = await readJsonBody(request);
        if (!body.ok) {
          return sendJson(response, 400, { error: 'Invalid JSON body' });
        }

        const data = body.value as { name?: string; outputPath?: string };
        if (!data.name || data.name.trim().length === 0) {
          return sendJson(response, 400, { error: 'Missing profile name' });
        }

        try {
          const result = await profileExportService.execute({
            cwd: dependencies.cwd,
            name: data.name.trim(),
            outputPath:
              typeof data.outputPath === 'string' && data.outputPath.trim().length > 0
                ? data.outputPath.trim()
                : undefined,
          });
          return sendJson(response, 200, result);
        } catch (error) {
          return sendProfileError(response, error);
        }
      }
      case '/api/profiles/import': {
        if (request.method !== 'POST') {
          return sendJson(response, 405, { error: 'Method not allowed' });
        }

        const body = await readJsonBody(request);
        if (!body.ok) {
          return sendJson(response, 400, { error: 'Invalid JSON body' });
        }

        const data = body.value as { archivePath?: string; force?: boolean };
        if (!data.archivePath || data.archivePath.trim().length === 0) {
          return sendJson(response, 400, { error: 'Missing archivePath' });
        }

        try {
          const result = await profileImportService.execute({
            cwd: dependencies.cwd,
            archivePath: data.archivePath.trim(),
            force: data.force === true,
          });
          return sendJson(response, 200, result);
        } catch (error) {
          return sendProfileError(response, error);
        }
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
        const agentMcpCheckMatch = url.pathname.match(/^\/api\/agents\/(claude|codex|gemini)\/mcps\/check$/);
        if (agentMcpCheckMatch) {
          const agentName = agentMcpCheckMatch[1] as AgentName;

          if (request.method !== 'POST') {
            return sendJson(response, 405, { error: 'Method not allowed' });
          }

          const body = await readJsonBody(request);
          if (!body.ok) {
            return sendJson(response, 400, { error: 'Invalid JSON body' });
          }

          const data = body.value as { key?: string; entry?: AgentMcpEntry };
          if (!data.key || !data.entry?.command) {
            return sendJson(response, 400, { error: 'Missing key or entry.command' });
          }

          const result = await mcpPreflightService.execute({
            cwd: dependencies.cwd,
            agent: agentName,
            key: data.key,
            entry: data.entry,
          });
          return sendJson(response, 200, result);
        }

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
              return sendHandledError(response, error, 'Failed to add MCP');
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
              return sendHandledError(response, error, 'Failed to remove MCP');
            }
          }

          return sendJson(response, 405, { error: 'Method not allowed' });
        }

        // Agent skill routes: /api/agents/:name/skills(/:key)
        const agentSkillCheckMatch = url.pathname.match(/^\/api\/agents\/(claude|codex|gemini)\/skills\/check$/);
        if (agentSkillCheckMatch) {
          const agentName = agentSkillCheckMatch[1] as AgentName;

          if (request.method !== 'POST') {
            return sendJson(response, 405, { error: 'Method not allowed' });
          }

          const body = await readJsonBody(request);
          if (!body.ok) {
            return sendJson(response, 400, { error: 'Invalid JSON body' });
          }

          const data = body.value as { name?: string; sourceAgent?: string; source?: string };
          if (!data.name || !data.sourceAgent) {
            return sendJson(response, 400, { error: 'Missing name or sourceAgent' });
          }

          const result = await skillPreflightService.execute({
            sourceAgent: data.sourceAgent as AgentName,
            targetAgent: agentName,
            skillName: data.name,
            source: typeof data.source === 'string' ? data.source : undefined,
          });
          return sendJson(response, 200, result);
        }

        const agentSkillMatch = url.pathname.match(/^\/api\/agents\/(claude|codex|gemini)\/skills(?:\/(.+))?$/);
        if (agentSkillMatch) {
          const agentName = agentSkillMatch[1] as AgentName;
          const skillKey = agentSkillMatch[2] ? decodeURIComponent(agentSkillMatch[2]) : null;

          if (request.method === 'POST' && !skillKey) {
            const body = await readJsonBody(request);
            if (!body.ok) {
              return sendJson(response, 400, { error: 'Invalid JSON body' });
            }
            const data = body.value as { name?: string; sourceAgent?: string; source?: string };
            if (!data.name || !data.sourceAgent) {
              return sendJson(response, 400, { error: 'Missing name or sourceAgent' });
            }
            try {
              const preflight = await skillPreflightService.execute({
                sourceAgent: data.sourceAgent as AgentName,
                targetAgent: agentName,
                skillName: data.name,
                source: typeof data.source === 'string' ? data.source : undefined,
              });
              const firstError = preflight.checks.find((check) => check.status === 'error');
              if (firstError) {
                throw new ValidationError(
                  `Skill "${data.name}" cannot be copied from ${data.sourceAgent} to ${agentName}: ${firstError.message}`
                );
              }

              await agentConfigService.copySkill({
                sourceAgent: data.sourceAgent as AgentName,
                targetAgent: agentName,
                skillName: data.name,
              });
              return sendJson(response, 200, { ok: true });
            } catch (error) {
              return sendHandledError(response, error, 'Failed to copy skill');
            }
          }

          if (request.method === 'DELETE' && skillKey) {
            try {
              await agentConfigService.removeSkill({
                agent: agentName,
                skillName: skillKey,
              });
              return sendJson(response, 200, { ok: true });
            } catch (error) {
              return sendHandledError(response, error, 'Failed to remove skill');
            }
          }

          return sendJson(response, 405, { error: 'Method not allowed' });
        }

        const agentPluginCheckMatch = url.pathname.match(/^\/api\/agents\/(claude|codex|gemini)\/plugins\/check$/);
        if (agentPluginCheckMatch) {
          const agentName = agentPluginCheckMatch[1] as AgentName;

          if (request.method !== 'POST') {
            return sendJson(response, 405, { error: 'Method not allowed' });
          }

          const body = await readJsonBody(request);
          if (!body.ok) {
            return sendJson(response, 400, { error: 'Invalid JSON body' });
          }

          const data = body.value as { name?: string; sourceAgent?: string };
          if (!data.name || !data.sourceAgent) {
            return sendJson(response, 400, { error: 'Missing name or sourceAgent' });
          }

          const sourcePlugin = await resolveSourcePlugin(agentConfigService, dependencies.cwd, {
            sourceAgent: data.sourceAgent as AgentName,
            name: data.name,
          });

          if (!sourcePlugin) {
            return sendJson(response, 400, {
              error: `Plugin "${data.name}" was not found in ${data.sourceAgent}.`,
            });
          }

          const result = await pluginInstallService.plan({
            cwd: dependencies.cwd,
            targetAgent: agentName,
            sourceAgent: data.sourceAgent as AgentName,
            plugin: sourcePlugin,
          });
          return sendJson(response, 200, result);
        }

        const agentPluginMatch = url.pathname.match(/^\/api\/agents\/(claude|codex|gemini)\/plugins(?:\/(.+))?$/);
        if (agentPluginMatch) {
          const agentName = agentPluginMatch[1] as AgentName;
          const pluginName = agentPluginMatch[2] ? decodeURIComponent(agentPluginMatch[2]) : null;

          if (request.method === 'POST' && !pluginName) {
            const body = await readJsonBody(request);
            if (!body.ok) {
              return sendJson(response, 400, { error: 'Invalid JSON body' });
            }

            const data = body.value as { name?: string; sourceAgent?: string };
            if (!data.name || !data.sourceAgent) {
              return sendJson(response, 400, { error: 'Missing name or sourceAgent' });
            }

            const sourcePlugin = await resolveSourcePlugin(agentConfigService, dependencies.cwd, {
              sourceAgent: data.sourceAgent as AgentName,
              name: data.name,
            });

            if (!sourcePlugin) {
              return sendJson(response, 400, {
                error: `Plugin "${data.name}" was not found in ${data.sourceAgent}.`,
              });
            }

            try {
              const result = await pluginInstallService.execute({
                cwd: dependencies.cwd,
                targetAgent: agentName,
                sourceAgent: data.sourceAgent as AgentName,
                plugin: sourcePlugin,
              });
              return sendJson(response, 200, result);
            } catch (error) {
              return sendHandledError(response, error, 'Failed to install plugin');
            }
          }

          if (request.method === 'DELETE' && pluginName) {
            const targetPlugin = await resolveTargetPlugin(agentConfigService, dependencies.cwd, {
              targetAgent: agentName,
              name: pluginName,
            });

            if (!targetPlugin) {
              return sendJson(response, 404, {
                error: `Plugin "${pluginName}" was not found in ${agentName}.`,
              });
            }

            try {
              const result = await pluginInstallService.remove({
                cwd: dependencies.cwd,
                targetAgent: agentName,
                plugin: targetPlugin,
              });
              return sendJson(response, 200, result);
            } catch (error) {
              return sendHandledError(response, error, 'Failed to remove plugin');
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

async function resolveSourcePlugin(
  agentConfigService: ReturnType<typeof createAgentConfigService>,
  cwd: string,
  options: { sourceAgent: AgentName; name: string }
): Promise<AgentSkillEntry | null> {
  const configs = await agentConfigService.readAll({ cwd });
  const sourceConfig = configs.find((config) => config.agent === options.sourceAgent);
  const plugin = sourceConfig?.skills.find(
    (entry) => entry.kind === 'plugin' && entry.name === options.name
  );
  return plugin ?? null;
}

async function resolveTargetPlugin(
  agentConfigService: ReturnType<typeof createAgentConfigService>,
  cwd: string,
  options: { targetAgent: AgentName; name: string }
): Promise<AgentSkillEntry | null> {
  const configs = await agentConfigService.readAll({ cwd });
  const targetConfig = configs.find((config) => config.agent === options.targetAgent);
  const plugin = targetConfig?.skills.find(
    (entry) => entry.kind === 'plugin' && entry.name === options.name
  );
  return plugin ?? null;
}

function sendHandledError(
  response: ServerResponse,
  error: unknown,
  fallbackMessage: string
): void {
  const isUserError = error instanceof BrainctlError && error.category === 'user';
  sendJson(response, isUserError ? 400 : 500, {
    error: error instanceof Error ? error.message : fallbackMessage,
  });
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
