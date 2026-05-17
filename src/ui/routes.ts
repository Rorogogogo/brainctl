import type { IncomingMessage, ServerResponse } from 'node:http';
import { existsSync } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { BrainctlError, ProfileError, ProfileNotFoundError, ValidationError } from '../errors.js';
import { createAgentConfigService } from '../services/agent/agent-config-service.js';
import type {
  AgentMcpEntry,
  AgentSkillEntry,
  PortableRemoteMcpMetadata,
} from '../services/agent/agent-config-service.js';
import { createMcpPreflightService } from '../services/platform/mcp-preflight-service.js';
import { createPluginInstallService } from '../services/plugin/plugin-install-service.js';
import { createProfileExportService } from '../services/profile/profile-export-service.js';
import { createProfileImportService } from '../services/profile/profile-import-service.js';
import { createProfileRegistryClient } from '../services/profile/profile-registry-client.js';
import { createProfileRegistryInstallService } from '../services/profile/profile-registry-install-service.js';
import { createProfilePublishService } from '../services/profile/profile-publish-service.js';
import {
  createBrainctlConfigService,
  resolveBrainctlApiBaseUrl,
  resolveBrainctlApiTarget,
  resolveBrainctlApiToken,
  resolveBrainctlFrontendUrl,
} from '../services/platform/brainctl-config-service.js';
import { createBrainctlTokenManager } from '../services/platform/brainctl-token-manager.js';
import { randomBytes } from 'node:crypto';
import {
  brainctlHome,
  createProfileService,
} from '../services/profile/profile-service.js';
import {
  createProfileEditService,
  type ProfileItemType,
} from '../services/profile/profile-edit-service.js';
import { createSkillPreflightService } from '../services/plugin/skill-preflight-service.js';
import { createStatusService } from '../services/platform/status-service.js';
import type { StatusService } from '../services/platform/status-service.js';
import {
  createProfileApplyService,
  type ItemSelector,
} from '../services/profile/profile-apply-service.js';
import {
  createProfileSnapshotService,
  defaultBackupProfileName,
} from '../services/profile/profile-snapshot-service.js';
import { normalizePortableProfileManifest } from '../services/profile/profile-manifest-normalizer.js';
import { createRecentProjectsService } from '../services/platform/recent-projects-service.js';
import type { AgentName } from '../types.js';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

function revealInFileManager(targetPath: string): void {
  if (process.platform === 'darwin') {
    spawn('open', ['-R', targetPath], { detached: true, stdio: 'ignore' }).unref();
    return;
  }
  if (process.platform === 'win32') {
    spawn('explorer', [`/select,${targetPath}`], { detached: true, stdio: 'ignore' }).unref();
    return;
  }
  spawn('xdg-open', [path.dirname(targetPath)], { detached: true, stdio: 'ignore' }).unref();
}

function resolveCwd(req: import('node:http').IncomingMessage, fallback: string): string {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const raw = url.searchParams.get('cwd');
  if (!raw) return fallback;
  if (!path.isAbsolute(raw)) return fallback;
  return raw;
}

export interface UiRouteDependencies {
  cwd: string;
  statusService?: StatusService;
  recentsFilePath?: string;
  claudeJsonPath?: string;
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
  const profileService = createProfileService();
  const profileExportService = createProfileExportService({ profileService });
  const profileImportService = createProfileImportService();
  const profileRegistryInstallService = createProfileRegistryInstallService({
    profileImportService,
  });
  const profileApplyService = createProfileApplyService({ profileService });
  const profileSnapshotService = createProfileSnapshotService();
  const agentConfigService = createAgentConfigService();
  const profileEditService = createProfileEditService({
    profileService,
    agentConfigService,
  });
  const mcpPreflightService = createMcpPreflightService();
  const pluginInstallService = createPluginInstallService();
  const skillPreflightService = createSkillPreflightService();
  const recentsFilePath = dependencies.recentsFilePath ?? path.join(os.homedir(), '.brainctl', 'recents.json');
  const claudeJsonPath = dependencies.claudeJsonPath ?? path.join(os.homedir(), '.claude.json');
  const recentProjectsService = createRecentProjectsService({ filePath: recentsFilePath });

  const brainctlConfigService = createBrainctlConfigService();
  const tokenManager = createBrainctlTokenManager({ configService: brainctlConfigService });
  type AuthOutcome =
    | { status: 'pending' }
    | { status: 'success'; at: number }
    | { status: 'error'; message: string; at: number };
  type AuthStateEntry = { expiresAt: number; outcome: AuthOutcome };
  const pendingAuthStates = new Map<string, AuthStateEntry>();
  const OUTCOME_RETENTION_MS = 60 * 1000;

  function sweepAuthStates(): void {
    const now = Date.now();
    for (const [key, entry] of pendingAuthStates) {
      if (entry.expiresAt < now) pendingAuthStates.delete(key);
    }
  }

  function newAuthState(): string {
    const state = randomBytes(16).toString('hex');
    pendingAuthStates.set(state, {
      expiresAt: Date.now() + 10 * 60 * 1000,
      outcome: { status: 'pending' },
    });
    sweepAuthStates();
    return state;
  }

  function validateAuthState(state: string | null): AuthStateEntry | null {
    if (!state) return null;
    const entry = pendingAuthStates.get(state);
    if (!entry) return null;
    if (entry.expiresAt < Date.now()) {
      pendingAuthStates.delete(state);
      return null;
    }
    return entry;
  }

  function markAuthOutcome(state: string, outcome: AuthOutcome): void {
    const entry = pendingAuthStates.get(state);
    if (!entry) return;
    entry.outcome = outcome;
    if (outcome.status !== 'pending') {
      entry.expiresAt = Date.now() + OUTCOME_RETENTION_MS;
    }
  }

  async function readClaudeProjectPaths(): Promise<string[]> {
    try {
      const raw = await readFile(claudeJsonPath, 'utf8');
      const data = JSON.parse(raw) as { projects?: Record<string, unknown> };
      return Object.keys(data.projects ?? {}).sort();
    } catch {
      return [];
    }
  }

  return async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');

    switch (url.pathname) {
      case '/api/auth/status': {
        if (request.method !== 'GET') {
          return sendJson(response, 405, { error: 'Method not allowed' });
        }
        const target = await resolveBrainctlApiTarget();
        const apiFrontendUrl = await resolveBrainctlFrontendUrl({ apiBaseUrl: target.apiBaseUrl });
        const apiInfo = {
          apiBaseUrl: target.apiBaseUrl,
          apiMode: target.mode,
          apiSource: target.source,
          apiFrontendUrl,
        };
        const resolved = await resolveBrainctlApiToken({ configService: brainctlConfigService });
        if (!resolved) {
          return sendJson(response, 200, { signedIn: false, ...apiInfo });
        }
        try {
          const me = await tokenManager.authenticatedFetch('/me');
          if (!me.ok) {
            return sendJson(response, 200, {
              signedIn: false,
              source: resolved.source,
              error: `HTTP ${me.status}`,
              ...apiInfo,
            });
          }
          const user = (await me.json()) as { email?: string; display_name?: string; avatar_url?: string | null };
          return sendJson(response, 200, {
            signedIn: true,
            source: resolved.source,
            user: {
              email: user.email,
              displayName: user.display_name,
              avatarUrl: user.avatar_url ?? undefined,
            },
            ...apiInfo,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return sendJson(response, 200, {
            signedIn: false,
            source: resolved.source,
            error: message,
            ...apiInfo,
          });
        }
      }

      case '/api/auth/start': {
        if (request.method !== 'POST') {
          return sendJson(response, 405, { error: 'Method not allowed' });
        }
        const state = newAuthState();
        const apiBase = await resolveBrainctlApiBaseUrl();
        const frontendBase = await resolveBrainctlFrontendUrl({ apiBaseUrl: apiBase });
        const host = request.headers.host ?? '127.0.0.1:3333';
        const port = host.includes(':') ? host.split(':')[1] : '3333';
        const callback = `http://127.0.0.1:${port}/auth/finish?state=${encodeURIComponent(state)}`;
        const url = `${frontendBase.replace(/\/$/, '')}/cli-login?state=${encodeURIComponent(state)}&callback=${encodeURIComponent(callback)}`;
        return sendJson(response, 200, { url, state });
      }

      case '/auth/finish': {
        if (request.method !== 'GET') {
          return sendJson(response, 405, { error: 'Method not allowed' });
        }
        const state = url.searchParams.get('state');
        const token = url.searchParams.get('token');
        const refreshToken = url.searchParams.get('refresh_token');
        const errorParam = url.searchParams.get('error');
        if (!validateAuthState(state)) {
          response.statusCode = 400;
          response.setHeader('content-type', 'text/html; charset=utf-8');
          response.end(authResultHtml('error', 'Invalid or expired sign-in request.'));
          return;
        }
        if (errorParam) {
          markAuthOutcome(state as string, {
            status: 'error',
            message: errorParam,
            at: Date.now(),
          });
          response.statusCode = 400;
          response.setHeader('content-type', 'text/html; charset=utf-8');
          response.end(authResultHtml('error', errorParam));
          return;
        }
        if (!token || token.trim().length === 0) {
          const message = 'No token returned by the brainctl platform.';
          markAuthOutcome(state as string, { status: 'error', message, at: Date.now() });
          response.statusCode = 400;
          response.setHeader('content-type', 'text/html; charset=utf-8');
          response.end(authResultHtml('error', message));
          return;
        }
        try {
          await tokenManager.saveTokens({
            accessToken: token.trim(),
            refreshToken: refreshToken?.trim() || undefined,
          });
          const verify = await tokenManager.authenticatedFetch('/me');
          if (!verify.ok) {
            await tokenManager.clear();
            const apiBase = await resolveBrainctlApiBaseUrl();
            const message =
              verify.status === 401
                ? `Token was rejected by the brainctl API at ${apiBase}. The platform you signed in through likely targets a different backend.`
                : `brainctl API at ${apiBase} returned HTTP ${verify.status} when verifying the token.`;
            markAuthOutcome(state as string, { status: 'error', message, at: Date.now() });
            response.statusCode = 401;
            response.setHeader('content-type', 'text/html; charset=utf-8');
            response.end(authResultHtml('error', message));
            return;
          }
          markAuthOutcome(state as string, { status: 'success', at: Date.now() });
          response.statusCode = 200;
          response.setHeader('content-type', 'text/html; charset=utf-8');
          response.end(authResultHtml('ok', 'You are signed in. You can close this tab.'));
        } catch (error) {
          const message = `Failed to save token: ${error instanceof Error ? error.message : String(error)}`;
          markAuthOutcome(state as string, { status: 'error', message, at: Date.now() });
          response.statusCode = 500;
          response.setHeader('content-type', 'text/html; charset=utf-8');
          response.end(authResultHtml('error', message));
        }
        return;
      }

      case '/api/auth/outcome': {
        if (request.method !== 'GET') {
          return sendJson(response, 405, { error: 'Method not allowed' });
        }
        const state = url.searchParams.get('state');
        const entry = validateAuthState(state);
        if (!entry) {
          return sendJson(response, 404, { status: 'unknown' });
        }
        const outcome = entry.outcome;
        if (outcome.status !== 'pending' && state) {
          pendingAuthStates.delete(state);
        }
        if (outcome.status === 'error') {
          return sendJson(response, 200, { status: 'error', message: outcome.message });
        }
        return sendJson(response, 200, { status: outcome.status });
      }

      case '/api/auth/logout': {
        if (request.method !== 'POST') {
          return sendJson(response, 405, { error: 'Method not allowed' });
        }
        await tokenManager.clear();
        return sendJson(response, 200, { ok: true });
      }

      case '/api/overview': {
        if (request.method !== 'GET') {
          return sendJson(response, 405, { error: 'Method not allowed' });
        }

        const overview = await statusService.execute({ cwd: dependencies.cwd });
        return sendJson(response, 200, overview);
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

        const configs = await agentConfigService.readAll({ cwd: resolveCwd(request, dependencies.cwd) });
        return sendJson(response, 200, configs);
      }
      case '/api/agents/claude/projects': {
        if (request.method !== 'GET') {
          return sendJson(response, 405, { error: 'Method not allowed' });
        }
        const projects = await agentConfigService.listClaudeProjects();
        return sendJson(response, 200, { projects });
      }
      case '/api/open-folder': {
        if (request.method !== 'POST') {
          return sendJson(response, 405, { error: 'Method not allowed' });
        }
        const body = await readJsonBody(request);
        if (!body.ok) {
          return sendJson(response, 400, { error: 'Invalid JSON body' });
        }
        const { path: folderPath } = (body.value ?? {}) as { path?: string };
        if (!folderPath || typeof folderPath !== 'string') {
          return sendJson(response, 400, { error: 'path is required' });
        }
        if (!existsSync(folderPath)) {
          return sendJson(response, 404, { error: `Path not found: ${folderPath}` });
        }
        try {
          revealInFileManager(folderPath);
          return sendJson(response, 200, { ok: true, path: folderPath });
        } catch (error) {
          return sendJson(response, 500, {
            error: error instanceof Error ? error.message : 'Failed to open folder',
          });
        }
      }
      case '/api/profiles': {
        if (request.method === 'GET') {
          const result = await profileService.list({ cwd: dependencies.cwd });
          const enriched = await Promise.all(
            result.profiles.map(async (name) => {
              const profileFolder = path.join(brainctlHome(), '.brainctl', 'profiles', name);
              const manifestPath = path.join(profileFolder, 'manifest.yaml');
              const publishedPath = path.join(profileFolder, 'published.yaml');
              const { readFile: rf } = await import('node:fs/promises');
              const yamlMod = await import('yaml');
              const out: {
                name: string;
                sourceAgent?: AgentName;
                published?: {
                  slug: string;
                  profileId?: string;
                  version?: string;
                  lastPublishedAt?: string;
                  apiBaseUrl?: string;
                  url?: string;
                  manageUrl?: string;
                };
              } = { name };
              try {
                const parsed = yamlMod.default.parse(
                  await rf(manifestPath, 'utf8')
                ) as { source?: { kind?: string; agent?: AgentName } } | null;
                const source = parsed?.source;
                if (source?.kind === 'agent' && source.agent) {
                  out.sourceAgent = source.agent;
                }
              } catch {
                // no manifest
              }
              try {
                const parsedPub = yamlMod.default.parse(
                  await rf(publishedPath, 'utf8')
                ) as {
                  slug?: string;
                  profileId?: string;
                  versionId?: string;
                  version?: string;
                  lastPublishedAt?: string;
                  apiBaseUrl?: string;
                } | null;
                if (parsedPub?.slug) {
                  const frontend = await resolveBrainctlFrontendUrl({
                    apiBaseUrl: parsedPub.apiBaseUrl,
                  });
                  const fe = frontend.replace(/\/$/, '');
                  out.published = {
                    slug: parsedPub.slug,
                    profileId: parsedPub.profileId,
                    version: parsedPub.version,
                    lastPublishedAt: parsedPub.lastPublishedAt,
                    apiBaseUrl: parsedPub.apiBaseUrl,
                    url: `${fe}/profiles/${parsedPub.slug}`,
                    manageUrl: parsedPub.profileId
                      ? `${fe}/app/profiles/${parsedPub.profileId}`
                      : undefined,
                  };
                }
              } catch {
                // not published
              }
              return out;
            })
          );
          return sendJson(response, 200, { profiles: enriched });
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

        const data = body.value as
          | {
              source?: { source?: 'profile'; name?: string } | { source?: 'agent'; agent?: string };
              name?: string;
              agent?: string;
              outputPath?: string;
            }
          | undefined;
        const source = data?.source;
        const agent =
          source?.source === 'agent'
            ? source.agent
            : data?.agent;
        const normalizedAgent =
          agent === 'claude' || agent === 'codex' || agent === 'gemini' ? agent : undefined;
        const name =
          source?.source === 'profile'
            ? source.name
            : data?.name;
        const normalizedName =
          typeof name === 'string' && name.trim().length > 0 ? name.trim() : undefined;

        if (!normalizedAgent && !normalizedName) {
          return sendJson(response, 400, { error: 'Missing profile name or agent' });
        }

        try {
          const result = await profileExportService.execute({
            cwd: dependencies.cwd,
            source: normalizedAgent
              ? { source: 'agent', agent: normalizedAgent, cwd: dependencies.cwd }
              : { source: 'profile', name: normalizedName as string },
            outputPath:
              typeof data?.outputPath === 'string' && data.outputPath.trim().length > 0
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

        const data = body.value as {
          archivePath?: string;
          force?: boolean;
          credentials?: Record<string, unknown>;
        };
        if (!data.archivePath || data.archivePath.trim().length === 0) {
          return sendJson(response, 400, { error: 'Missing archivePath' });
        }

        try {
          const result = await profileImportService.execute({
            cwd: dependencies.cwd,
            archivePath: data.archivePath.trim(),
            force: data.force === true,
            credentials: parseCredentialMap(data.credentials),
          });
          return sendJson(response, 200, result);
        } catch (error) {
          return sendProfileError(response, error);
        }
      }
      case '/api/profiles/import-upload': {
        if (request.method !== 'POST') {
          return sendJson(response, 405, { error: 'Method not allowed' });
        }

        const url = new URL(request.url ?? '/', 'http://localhost');
        const force = url.searchParams.get('force') === 'true';

        const chunks: Buffer[] = [];
        for await (const chunk of request) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        const bytes = Buffer.concat(chunks);
        if (bytes.length === 0) {
          return sendJson(response, 400, { error: 'Empty upload body' });
        }

        const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
        const { tmpdir } = await import('node:os');
        const dir = await mkdtemp(path.join(tmpdir(), 'brainctl-upload-'));
        const archivePath = path.join(dir, 'profile.tar.gz');
        try {
          await writeFile(archivePath, bytes);
          const result = await profileImportService.execute({
            cwd: dependencies.cwd,
            archivePath,
            force,
          });
          return sendJson(response, 200, result);
        } catch (error) {
          return sendProfileError(response, error);
        } finally {
          await rm(dir, { recursive: true, force: true }).catch(() => {});
        }
      }
      case '/api/profiles/install-from-registry': {
        if (request.method !== 'POST') {
          return sendJson(response, 405, { error: 'Method not allowed' });
        }

        const body = await readJsonBody(request);
        if (!body.ok) {
          return sendJson(response, 400, { error: 'Invalid JSON body' });
        }

        const data = body.value as {
          slug?: string;
          force?: boolean;
          credentials?: Record<string, unknown>;
          apiBaseUrl?: string;
        };
        const slug = typeof data.slug === 'string' ? data.slug.trim() : '';
        if (!slug) {
          return sendJson(response, 400, { error: 'Missing slug' });
        }

        try {
          const apiBaseUrl = await resolveBrainctlApiBaseUrl({ apiBaseUrl: data.apiBaseUrl });
          const tokenInfo = await resolveBrainctlApiToken();
          const result = await profileRegistryInstallService.execute({
            slug,
            apiBaseUrl,
            token: tokenInfo?.token,
            cwd: dependencies.cwd,
            force: data.force === true,
            credentials: parseCredentialMap(data.credentials),
          });
          return sendJson(response, 200, result);
        } catch (error) {
          return sendProfileError(response, error);
        }
      }
      case '/api/profiles/publish': {
        if (request.method !== 'POST') {
          return sendJson(response, 405, { error: 'Method not allowed' });
        }

        const body = await readJsonBody(request);
        if (!body.ok) {
          return sendJson(response, 400, { error: 'Invalid JSON body' });
        }

        const data = body.value as {
          profileName?: string;
          slug?: string;
          title?: string;
          summary?: string;
          version?: string;
          changelog?: string;
          visibility?: 'public' | 'private';
          apiBaseUrl?: string;
          token?: string;
        };

        const profileName =
          typeof data.profileName === 'string' ? data.profileName.trim() : '';
        const slug = typeof data.slug === 'string' ? data.slug.trim() : '';
        const title = typeof data.title === 'string' ? data.title.trim() : '';
        if (!profileName || !slug || !title) {
          return sendJson(response, 400, {
            error: 'profileName, slug, and title are required',
          });
        }

        const hasToken = (await tokenManager.getAccessToken()) !== null;
        if (!hasToken) {
          return sendJson(response, 401, {
            error: 'No brainctl API token configured. Sign in or set BRAINCTL_API_TOKEN.',
          });
        }

        try {
          const publishService = createProfilePublishService({
            profileExportService,
          });
          const apiBaseUrl = await resolveBrainctlApiBaseUrl({ apiBaseUrl: data.apiBaseUrl });
          const result = await publishService.execute({
            cwd: dependencies.cwd,
            profileName,
            slug,
            title,
            summary: data.summary,
            version: data.version,
            changelog: data.changelog,
            visibility: data.visibility,
            apiBaseUrl,
            fetch: (input, init) =>
              tokenManager.authenticatedFetch(
                typeof input === 'string' ? input : input.toString(),
                init
              ),
          });
          return sendJson(response, 200, { ok: true, ...result });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const upstreamStatus = /HTTP (\d{3})/.exec(message)?.[1];
          const status =
            upstreamStatus && /^4\d\d$/.test(upstreamStatus)
              ? Number(upstreamStatus)
              : 502;
          return sendJson(response, status, { error: message });
        }
      }
      case '/api/profiles/register-github': {
        if (request.method !== 'POST') {
          return sendJson(response, 405, { error: 'Method not allowed' });
        }

        const body = await readJsonBody(request);
        if (!body.ok) {
          return sendJson(response, 400, { error: 'Invalid JSON body' });
        }

        const data = body.value as {
          repoUrl?: string;
          slug?: string;
          title?: string;
          summary?: string;
          refName?: string;
          profilePath?: string;
          apiBaseUrl?: string;
          token?: string;
        };

        const repoUrl = typeof data.repoUrl === 'string' ? data.repoUrl.trim() : '';
        const slug = typeof data.slug === 'string' ? data.slug.trim() : '';
        const title = typeof data.title === 'string' ? data.title.trim() : '';
        if (!repoUrl || !slug || !title) {
          return sendJson(response, 400, {
            error: 'repoUrl, slug, and title are required',
          });
        }

        const hasToken = (await tokenManager.getAccessToken()) !== null;
        if (!hasToken) {
          return sendJson(response, 401, {
            error: 'No brainctl API token configured. Sign in or set BRAINCTL_API_TOKEN.',
          });
        }

        try {
          const client = createProfileRegistryClient({
            fetch: (input, init) =>
              tokenManager.authenticatedFetch(
                typeof input === 'string' ? input : input.toString(),
                init
              ),
            baseUrl: await resolveBrainctlApiBaseUrl({ apiBaseUrl: data.apiBaseUrl }),
          });
          const result = await client.registerGithubProfile({
            repoUrl,
            slug,
            title,
            summary: data.summary,
            refName: data.refName,
            profilePath: data.profilePath,
            manifestJson: { name: slug },
          });
          return sendJson(response, 200, { ok: true, result });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const upstreamStatus = /HTTP (\d{3})/.exec(message)?.[1];
          const status =
            upstreamStatus && /^4\d\d$/.test(upstreamStatus)
              ? Number(upstreamStatus)
              : 502;
          return sendJson(response, status, { error: message });
        }
      }
      case '/api/projects': {
        if (request.method !== 'GET') {
          return sendJson(response, 405, { error: 'Method not allowed' });
        }
        const [claudeProjects, recents] = await Promise.all([
          readClaudeProjectPaths(),
          recentProjectsService.read(),
        ]);
        return sendJson(response, 200, {
          current: dependencies.cwd,
          claudeProjects,
          recents,
        });
      }

      case '/api/projects/recent': {
        if (request.method !== 'POST') {
          return sendJson(response, 405, { error: 'Method not allowed' });
        }
        const body = await readJsonBody(request);
        if (!body.ok) {
          return sendJson(response, 400, { error: 'Invalid JSON body' });
        }
        const value = body.value as { cwd?: unknown };
        const cwd = typeof value?.cwd === 'string' ? value.cwd : '';
        if (!path.isAbsolute(cwd)) {
          return sendJson(response, 400, { error: 'cwd must be an absolute path' });
        }
        const recents = await recentProjectsService.addRecent(cwd);
        return sendJson(response, 200, { recents });
      }

      case '/api/fs/browse': {
        if (request.method !== 'GET') {
          return sendJson(response, 405, { error: 'Method not allowed' });
        }
        const raw = url.searchParams.get('path');
        const mode = url.searchParams.get('mode') === 'file' ? 'file' : 'dir';
        const startPath =
          raw && path.isAbsolute(raw) ? raw : os.homedir();
        try {
          const stats = await stat(startPath);
          if (!stats.isDirectory()) {
            return sendJson(response, 400, { error: 'Path is not a directory' });
          }
          const entries = await readdir(startPath, { withFileTypes: true });
          const items = entries
            .filter((entry) => !entry.name.startsWith('.'))
            .filter((entry) => {
              if (mode === 'file') return entry.isDirectory() || entry.isFile();
              return entry.isDirectory();
            })
            .map((entry) => ({
              name: entry.name,
              isDir: entry.isDirectory(),
            }))
            .sort((a, b) => {
              if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
              return a.name.localeCompare(b.name);
            });
          const parent = path.dirname(startPath);
          return sendJson(response, 200, {
            path: startPath,
            parent: parent === startPath ? null : parent,
            home: os.homedir(),
            entries: items,
          });
        } catch (error) {
          return sendJson(response, 404, {
            error: error instanceof Error ? error.message : 'Cannot read path',
          });
        }
      }

      case '/api/profiles/snapshot': {
        if (request.method !== 'POST') {
          return sendJson(response, 405, { error: 'Method not allowed' });
        }
        const body = await readJsonBody(request);
        if (!body.ok) {
          return sendJson(response, 400, { error: 'Invalid JSON body' });
        }
        const data = (body.value ?? {}) as { agent?: AgentName; as?: string };
        if (data.agent !== 'claude' && data.agent !== 'codex' && data.agent !== 'gemini') {
          return sendJson(response, 400, { error: 'Invalid agent' });
        }
        const profileName = data.as ?? defaultBackupProfileName(data.agent);
        if (acceptsNdjson(request)) {
          response.statusCode = 200;
          response.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
          response.setHeader('Cache-Control', 'no-cache');
          try {
            const result = await profileSnapshotService.execute({
              cwd: dependencies.cwd,
              agent: data.agent,
              profileName,
              onProgress: (message) => {
                writeNdjson(response, { type: 'progress', message });
              },
            });
            writeNdjson(response, { type: 'result', profileName, ...result });
          } catch (error) {
            writeNdjson(response, {
              type: 'error',
              error: error instanceof Error ? error.message : 'Internal server error',
            });
          } finally {
            response.end();
          }
          return;
        }
        try {
          const result = await profileSnapshotService.execute({
            cwd: dependencies.cwd,
            agent: data.agent,
            profileName,
          });
          return sendJson(response, 200, { profileName, ...result });
        } catch (error) {
          return sendProfileError(response, error);
        }
      }
      default: {
        // Open profile folder in OS file explorer: POST /api/profiles/:name/open-folder
        const openFolderMatch = url.pathname.match(/^\/api\/profiles\/([^/]+)\/open-folder$/);
        if (openFolderMatch) {
          if (request.method !== 'POST') {
            return sendJson(response, 405, { error: 'Method not allowed' });
          }
          const profileName = decodeURIComponent(openFolderMatch[1]);
          const folderPath = path.join(brainctlHome(), '.brainctl', 'profiles', profileName);
          if (!existsSync(folderPath)) {
            return sendJson(response, 404, { error: `Profile folder not found: ${folderPath}` });
          }
          try {
            revealInFileManager(folderPath);
            return sendJson(response, 200, { ok: true, path: folderPath });
          } catch (error) {
            return sendJson(response, 500, {
              error: error instanceof Error ? error.message : 'Failed to open folder',
            });
          }
        }

        // Profile item add/remove: /api/profiles/:name/items
        const itemsMatch = url.pathname.match(/^\/api\/profiles\/([^/]+)\/items$/);
        if (itemsMatch) {
          const profileName = decodeURIComponent(itemsMatch[1]);
          if (request.method === 'POST') {
            const body = await readJsonBody(request);
            if (!body.ok) {
              return sendJson(response, 400, { error: 'Invalid JSON body' });
            }
            const data = (body.value ?? {}) as {
              type?: ProfileItemType;
              agent?: AgentName;
              name?: string;
            };
            if (
              !data.type ||
              !data.name ||
              !data.agent ||
              !['mcp', 'plugin', 'skill'].includes(data.type) ||
              !['claude', 'codex', 'gemini'].includes(data.agent)
            ) {
              return sendJson(response, 400, {
                error: 'type, agent, and name are required',
              });
            }
            try {
              await profileEditService.addItem({
                cwd: dependencies.cwd,
                profileName,
                type: data.type,
                agent: data.agent,
                name: data.name,
              });
              return sendJson(response, 200, { ok: true });
            } catch (error) {
              return sendProfileError(response, error);
            }
          }
          if (request.method === 'DELETE') {
            const type = url.searchParams.get('type') as ProfileItemType | null;
            const name = url.searchParams.get('name');
            const agentParam = url.searchParams.get('agent');
            if (!type || !name || !['mcp', 'plugin', 'skill'].includes(type)) {
              return sendJson(response, 400, { error: 'type and name are required' });
            }
            const agent =
              agentParam && ['claude', 'codex', 'gemini'].includes(agentParam)
                ? (agentParam as AgentName)
                : undefined;
            try {
              await profileEditService.removeItem({
                cwd: dependencies.cwd,
                profileName,
                type,
                name,
                agent,
              });
              return sendJson(response, 200, { ok: true });
            } catch (error) {
              return sendProfileError(response, error);
            }
          }
          return sendJson(response, 405, { error: 'Method not allowed' });
        }

        // Profile apply: POST /api/profiles/:name/apply
        const applyMatch = url.pathname.match(/^\/api\/profiles\/([^/]+)\/apply$/);
        if (applyMatch) {
          if (request.method !== 'POST') {
            return sendJson(response, 405, { error: 'Method not allowed' });
          }
          const profileName = decodeURIComponent(applyMatch[1]);
          const body = await readJsonBody(request);
          if (!body.ok) {
            return sendJson(response, 400, { error: 'Invalid JSON body' });
          }
          const data = (body.value ?? {}) as {
            agents?: AgentName[];
            items?: ItemSelector[];
            backup?: boolean;
            replace?: boolean;
          };

          try {
            const result = await profileApplyService.execute({
              cwd: dependencies.cwd,
              profileName,
              agents: data.agents ?? (['claude', 'codex', 'gemini'] as AgentName[]),
              items: data.items,
              backup: data.backup,
              replace: data.replace,
            });
            return sendJson(response, 200, result);
          } catch (error) {
            return sendProfileError(response, error);
          }
        }

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

          const data = body.value as {
            key?: string;
            entry?: AgentMcpEntry;
            remoteEntry?: PortableRemoteMcpMetadata;
          };
          if (!data.key || (!data.entry?.command && !data.remoteEntry?.url)) {
            return sendJson(response, 400, { error: 'Missing key and MCP payload' });
          }

          const result = await mcpPreflightService.execute({
            cwd: resolveCwd(request, dependencies.cwd),
            agent: agentName,
            key: data.key,
            entry: data.entry,
            remoteEntry: data.remoteEntry,
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
            const data = body.value as {
              key?: string;
              entry?: AgentMcpEntry;
              remoteEntry?: PortableRemoteMcpMetadata;
              scope?: 'global' | 'project';
            };
            if (!data.key || (!data.entry?.command && !data.remoteEntry?.url)) {
              return sendJson(response, 400, { error: 'Missing key and MCP payload' });
            }
            try {
              await agentConfigService.addMcp({
                cwd: resolveCwd(request, dependencies.cwd),
                agent: agentName,
                key: data.key,
                entry: data.entry,
                remoteEntry: data.remoteEntry,
                scope: data.scope === 'project' ? 'project' : 'global',
              });
              return sendJson(response, 200, { ok: true });
            } catch (error) {
              return sendHandledError(response, error, 'Failed to add MCP');
            }
          }

          if (request.method === 'PATCH' && mcpKey) {
            const body = await readJsonBody(request);
            if (!body.ok) {
              return sendJson(response, 400, { error: 'Invalid JSON body' });
            }
            const data = body.value as {
              fromScope?: string;
              toScope?: string;
              fromProjectPath?: string;
              toProjectPath?: string;
            };
            const fromScope = data.fromScope === 'project' ? 'project' : 'global';
            const toScope = data.toScope === 'project' ? 'project' : 'global';
            const fromProjectPath = typeof data.fromProjectPath === 'string' ? data.fromProjectPath : undefined;
            const toProjectPath = typeof data.toProjectPath === 'string' ? data.toProjectPath : undefined;
            const sameLocation =
              fromScope === toScope &&
              (fromScope === 'global' || (fromProjectPath ?? '') === (toProjectPath ?? ''));
            if (sameLocation) {
              return sendJson(response, 400, { error: 'Source and destination must differ' });
            }
            try {
              await agentConfigService.moveMcpScope({
                cwd: resolveCwd(request, dependencies.cwd),
                agent: agentName,
                key: mcpKey,
                fromScope,
                toScope,
                fromProjectPath,
                toProjectPath,
              });
              return sendJson(response, 200, { ok: true });
            } catch (error) {
              return sendHandledError(response, error, 'Failed to move MCP scope');
            }
          }

          if (request.method === 'DELETE' && mcpKey) {
            const scope = url.searchParams.get('scope') === 'project' ? 'project' : 'global';
            try {
              await agentConfigService.removeMcp({
                cwd: resolveCwd(request, dependencies.cwd),
                agent: agentName,
                key: mcpKey,
                scope,
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

          const sourcePlugin = await resolveSourcePlugin(agentConfigService, resolveCwd(request, dependencies.cwd), {
            sourceAgent: data.sourceAgent as AgentName,
            name: data.name,
          });

          if (!sourcePlugin) {
            return sendJson(response, 400, {
              error: `Plugin "${data.name}" was not found in ${data.sourceAgent}.`,
            });
          }

          const result = await pluginInstallService.plan({
            cwd: resolveCwd(request, dependencies.cwd),
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

            const sourcePlugin = await resolveSourcePlugin(agentConfigService, resolveCwd(request, dependencies.cwd), {
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
                cwd: resolveCwd(request, dependencies.cwd),
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
            const targetPlugin = await resolveTargetPlugin(agentConfigService, resolveCwd(request, dependencies.cwd), {
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
                cwd: resolveCwd(request, dependencies.cwd),
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

        // Profile contents: GET /api/profiles/:name/contents
        const contentsMatch = url.pathname.match(/^\/api\/profiles\/([^/]+)\/contents$/);
        if (contentsMatch) {
          if (request.method !== 'GET') {
            return sendJson(response, 405, { error: 'Method not allowed' });
          }
          const profileName = decodeURIComponent(contentsMatch[1]);
          try {
            const profile = await profileService.get({ cwd: dependencies.cwd, name: profileName });
            const manifestPath = path.join(
              brainctlHome(),
              '.brainctl',
              'profiles',
              profileName,
              'manifest.yaml'
            );
            let manifest: unknown = null;
            try {
              const { readFile: readManifest } = await import('node:fs/promises');
              const yamlMod = await import('yaml');
              const parsedManifest = yamlMod.default.parse(await readManifest(manifestPath, 'utf8'));
              manifest = parsedManifest && typeof parsedManifest === 'object' && !Array.isArray(parsedManifest)
                ? normalizePortableProfileManifest(parsedManifest as import('../types.js').PortableProfileManifest)
                : parsedManifest;
            } catch {
              manifest = null;
            }
            return sendJson(response, 200, { profile, manifest });
          } catch (error) {
            return sendProfileError(response, error);
          }
        }

        const profileRenameMatch = url.pathname.match(/^\/api\/profiles\/([^/]+)\/rename$/);
        if (profileRenameMatch) {
          const oldName = decodeURIComponent(profileRenameMatch[1]);

          if (request.method !== 'POST') {
            return sendJson(response, 405, { error: 'Method not allowed' });
          }

          const body = await readJsonBody(request);
          if (!body.ok) {
            return sendJson(response, 400, { error: 'Invalid JSON body' });
          }

          const data = body.value as { newName?: string };
          if (typeof data.newName !== 'string' || data.newName.trim().length === 0) {
            return sendJson(response, 400, { error: 'Missing newName' });
          }

          try {
            await profileService.rename({
              cwd: dependencies.cwd,
              oldName,
              newName: data.newName.trim(),
            });
            return sendJson(response, 200, { ok: true, name: data.newName.trim() });
          } catch (error) {
            return sendProfileError(response, error);
          }
        }

        const profileMatch = url.pathname.match(/^\/api\/profiles\/([^/]+)$/);
        if (profileMatch) {
          const name = decodeURIComponent(profileMatch[1]);

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

function parseCredentialMap(value: Record<string, unknown> | undefined): Record<string, string> | undefined {
  if (!value) {
    return undefined;
  }

  const credentials: Record<string, string> = {};
  for (const [key, credentialValue] of Object.entries(value)) {
    if (typeof credentialValue !== 'string' || credentialValue.trim().length === 0) {
      throw new ProfileError(`Credential "${key}" must be a non-empty string.`);
    }
    credentials[key] = credentialValue;
  }

  return Object.keys(credentials).length > 0 ? credentials : undefined;
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

function authResultHtml(kind: 'ok' | 'error', message: string): string {
  const color = kind === 'ok' ? '#16a34a' : '#dc2626';
  const title = kind === 'ok' ? 'Signed in to brainctl' : 'Sign-in failed';
  const safe = message.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const autoCloseScript =
    kind === 'ok'
      ? `<script>(function(){
    var seconds=3;
    var label=document.getElementById('countdown');
    var btn=document.getElementById('close-btn');
    function tryClose(){try{window.close();}catch(_){}}
    btn&&btn.addEventListener('click',tryClose);
    var timer=setInterval(function(){
      seconds-=1;
      if(label)label.textContent=String(seconds);
      if(seconds<=0){clearInterval(timer);tryClose();}
    },1000);
  })();</script>`
      : '';
  const body =
    kind === 'ok'
      ? `<div class="card"><h1><span class="dot"></span>${title}</h1>
    <p>${safe}</p>
    <p class="hint">Return to the brainctl dashboard to continue. This tab will close in <span id="countdown">3</span>s.</p>
    <button id="close-btn" type="button" class="btn">Close this tab</button>
  </div>`
      : `<div class="card"><h1><span class="dot"></span>${title}</h1><p>${safe}</p></div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>
    body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;color:#18181b;background:#fafafa}
    .card{max-width:420px;text-align:center;padding:32px;border:1px solid #e4e4e7;border-radius:16px;background:white;box-shadow:0 1px 2px rgba(0,0,0,.04)}
    h1{margin:0 0 8px;font-size:18px}
    p{margin:0;color:#52525b;font-size:14px}
    .hint{margin-top:12px}
    .btn{margin-top:20px;padding:8px 16px;font-size:14px;border:1px solid #d4d4d8;border-radius:8px;background:white;color:#18181b;cursor:pointer}
    .btn:hover{background:#f4f4f5}
    .dot{display:inline-block;width:10px;height:10px;border-radius:50%;background:${color};margin-right:8px;vertical-align:middle}
  </style></head><body>${body}${autoCloseScript}</body></html>`;
}

function acceptsNdjson(request: IncomingMessage): boolean {
  return String(request.headers.accept ?? '')
    .split(',')
    .some((value) => value.trim().toLowerCase().startsWith('application/x-ndjson'));
}

function writeNdjson(response: ServerResponse, body: unknown): void {
  response.write(`${JSON.stringify(body)}\n`);
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
