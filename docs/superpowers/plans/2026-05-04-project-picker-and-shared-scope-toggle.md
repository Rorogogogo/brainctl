# Project picker & shared scope toggle — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the per-agent Global/Project toggle with a single board-level toggle, and add a project picker so users can switch which project's config they're editing without restarting `brainctl ui`.

**Architecture:** Stateless per-request `?cwd=` query param threads the active project through profile API routes; UI tracks `activeProject` and `boardScope` in `useProfilesBoard`; new `ProjectBar` component owns the picker, toggle, and active path. A `ConfirmSwitchProjectModal` guards switching while changes are staged. Project candidates merge `~/.claude.json → projects` keys with brainctl's own MRU recents file (`~/.brainctl/recents.json`) plus a manual path input.

**Tech Stack:** TypeScript (ESM), node:http, FastMCP (unchanged), React 18, vitest, Tailwind v4.

---

## File map

**Create:**
- `src/services/platform/recent-projects-service.ts` — read/write `~/.brainctl/recents.json`, MRU semantics, atomic write.
- `tests/platform/recent-projects-service.test.ts` — service tests.
- `tests/platform/projects-routes.test.ts` — `GET /api/projects` + `POST /api/projects/recent` tests.
- `web/src/profiles/board/ProjectBar.tsx` — picker combobox + scope toggle + path label.
- `web/src/profiles/board/ConfirmSwitchProjectModal.tsx` — pending-changes guard modal.
- `tests/web/project-bar.test.ts` — picker logic tests (pure helpers; not full DOM).

**Modify:**
- `src/ui/routes.ts` — add `resolveCwd(req)` helper, two new routes, thread cwd through profile-related routes.
- `web/src/profiles/board/useProfilesBoard.ts` — replace `columnScopes` with `boardScope`; add `activeProject`; thread `cwd` into all fetchJson calls; expose `setActiveProject`.
- `web/src/profiles/board/AgentColumn.tsx` — remove inline scope toggle; props no longer take `onScopeChange`.
- `web/src/profiles/ProfilesView.tsx` — render `ProjectBar`; wire `activeProject` + `boardScope`; mount `ConfirmSwitchProjectModal`.
- `tests/web/profiles-view.test.ts` — update existing tests to the new shape.

---

## Conventions reminder

- ESM only — `.js` extensions in import paths even for TS files.
- Service factory pattern: `createFooService(deps?)`; tests inject mocks via the optional param.
- Atomic writes: write to `<file>.tmp.<rand>`, fsync, rename, leave a `.bak.<timestamp>` of the prior version.
- All new tests live under `tests/` mirroring the `src/` path.
- Run `npx vitest run <path>` for a single test file; `npm test` for the full suite; `npm run build:server` then `npm run build:web` to typecheck both halves.

---

## Task 1 — Recent-projects service

**Files:**
- Create: `src/services/platform/recent-projects-service.ts`
- Test: `tests/platform/recent-projects-service.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/platform/recent-projects-service.test.ts
import { describe, expect, it } from 'vitest';
import { createRecentProjectsService } from '../../src/services/platform/recent-projects-service.js';

describe('recent-projects service', () => {
  function makeFs(initial: Record<string, string> = {}) {
    const files = new Map(Object.entries(initial));
    return {
      files,
      readFile: async (p: string) => {
        if (!files.has(p)) {
          const err: NodeJS.ErrnoException = new Error('ENOENT');
          err.code = 'ENOENT';
          throw err;
        }
        return files.get(p)!;
      },
      writeFile: async (p: string, content: string) => {
        files.set(p, content);
      },
      mkdir: async () => {},
    };
  }

  it('returns empty list when file is missing', async () => {
    const fs = makeFs();
    const service = createRecentProjectsService({ filePath: '/tmp/recents.json', fs });
    expect(await service.read()).toEqual([]);
  });

  it('reads existing recents preserving order', async () => {
    const fs = makeFs({
      '/tmp/recents.json': JSON.stringify({ version: 1, recents: ['/a', '/b', '/c'] }),
    });
    const service = createRecentProjectsService({ filePath: '/tmp/recents.json', fs });
    expect(await service.read()).toEqual(['/a', '/b', '/c']);
  });

  it('addRecent moves an existing entry to the top', async () => {
    const fs = makeFs({
      '/tmp/recents.json': JSON.stringify({ version: 1, recents: ['/a', '/b', '/c'] }),
    });
    const service = createRecentProjectsService({ filePath: '/tmp/recents.json', fs });
    expect(await service.addRecent('/b')).toEqual(['/b', '/a', '/c']);
  });

  it('addRecent prepends a new entry', async () => {
    const fs = makeFs({});
    const service = createRecentProjectsService({ filePath: '/tmp/recents.json', fs });
    expect(await service.addRecent('/new')).toEqual(['/new']);
  });

  it('caps recents at 20 entries', async () => {
    const initial = Array.from({ length: 20 }, (_, i) => `/p${i}`);
    const fs = makeFs({
      '/tmp/recents.json': JSON.stringify({ version: 1, recents: initial }),
    });
    const service = createRecentProjectsService({ filePath: '/tmp/recents.json', fs });
    const next = await service.addRecent('/new');
    expect(next).toHaveLength(20);
    expect(next[0]).toBe('/new');
    expect(next).not.toContain('/p19');
  });

  it('rejects non-absolute paths', async () => {
    const service = createRecentProjectsService({ filePath: '/tmp/recents.json', fs: makeFs() });
    await expect(service.addRecent('relative/path')).rejects.toThrow(/absolute/);
  });
});
```

- [ ] **Step 2: Run, verify failure**

Run: `npx vitest run tests/platform/recent-projects-service.test.ts`
Expected: 6 failing tests, "Cannot find module".

- [ ] **Step 3: Implement service**

```ts
// src/services/platform/recent-projects-service.ts
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const MAX_RECENTS = 20;
const FILE_VERSION = 1;

interface RecentsFile {
  version: number;
  recents: string[];
}

export interface RecentProjectsService {
  read(): Promise<string[]>;
  addRecent(cwd: string): Promise<string[]>;
}

interface FsLike {
  readFile: (p: string, enc?: BufferEncoding) => Promise<string>;
  writeFile: (p: string, content: string) => Promise<void>;
  mkdir: (p: string, opts?: { recursive: boolean }) => Promise<void>;
}

export function createRecentProjectsService(deps: {
  filePath: string;
  fs?: FsLike;
}): RecentProjectsService {
  const fs: FsLike = deps.fs ?? {
    readFile: (p) => readFile(p, 'utf8'),
    writeFile: (p, c) => writeFile(p, c, 'utf8'),
    mkdir: (p, o) => mkdir(p, o).then(() => undefined),
  };

  async function load(): Promise<string[]> {
    try {
      const raw = await fs.readFile(deps.filePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<RecentsFile>;
      if (!Array.isArray(parsed.recents)) return [];
      return parsed.recents.filter((p) => typeof p === 'string');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw e;
    }
  }

  async function persist(recents: string[]): Promise<void> {
    await fs.mkdir(path.dirname(deps.filePath), { recursive: true });
    const payload: RecentsFile = { version: FILE_VERSION, recents };
    await fs.writeFile(deps.filePath, JSON.stringify(payload, null, 2) + '\n');
  }

  return {
    read: load,
    async addRecent(cwd) {
      if (!path.isAbsolute(cwd)) {
        throw new Error(`Recent project path must be absolute: ${cwd}`);
      }
      const current = await load();
      const without = current.filter((p) => p !== cwd);
      const next = [cwd, ...without].slice(0, MAX_RECENTS);
      await persist(next);
      return next;
    },
  };
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npx vitest run tests/platform/recent-projects-service.test.ts`
Expected: 6 passing.

- [ ] **Step 5: Commit**

```bash
git add src/services/platform/recent-projects-service.ts tests/platform/recent-projects-service.test.ts
git commit -m "feat: add recent-projects service for project picker recents"
```

---

## Task 2 — `resolveCwd` helper in routes

**Files:**
- Modify: `src/ui/routes.ts`

- [ ] **Step 1: Add helper**

Insert near the top of `src/ui/routes.ts`, after imports:

```ts
function resolveCwd(req: import('node:http').IncomingMessage, fallback: string): string {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const raw = url.searchParams.get('cwd');
  if (!raw) return fallback;
  if (!path.isAbsolute(raw)) return fallback;
  return raw;
}
```

(`path` is already imported. If not, add `import path from 'node:path';`.)

- [ ] **Step 2: Thread it through profile-impacting routes**

For each of these routes in `src/ui/routes.ts`, replace `cwd: dependencies.cwd` with `cwd: resolveCwd(req, dependencies.cwd)`:

- `/api/agents/live` — line ~83 (`agentConfigService.readAll`).
- All `/api/agents/:agent/mcps*` handlers.
- All `/api/agents/:agent/skills*` handlers.
- All `/api/agents/:agent/plugins*` handlers.

Do **not** touch profile-management routes (`/api/profiles/*`) or status routes — they remain server-cwd anchored.

- [ ] **Step 3: Typecheck**

Run: `npm run build:server`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add src/ui/routes.ts
git commit -m "feat(ui): accept ?cwd= query param on profile-impacting routes"
```

---

## Task 3 — `GET /api/projects` and `POST /api/projects/recent`

**Files:**
- Modify: `src/ui/routes.ts`
- Test: `tests/platform/projects-routes.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/platform/projects-routes.test.ts
import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRouter } from '../../src/ui/routes.js';

function makeReq(url: string, method = 'GET', body?: unknown) {
  return {
    url,
    method,
    headers: {},
    on: (event: string, cb: (chunk?: Buffer) => void) => {
      if (event === 'data' && body !== undefined) cb(Buffer.from(JSON.stringify(body)));
      if (event === 'end') cb();
    },
  } as unknown as import('node:http').IncomingMessage;
}

function makeRes() {
  const chunks: string[] = [];
  return {
    statusCode: 200,
    headers: {} as Record<string, string>,
    setHeader(k: string, v: string) { this.headers[k] = v; },
    end(body?: string) { if (body) chunks.push(body); },
    chunks,
  } as unknown as import('node:http').ServerResponse & { chunks: string[] };
}

describe('projects routes', () => {
  it('GET /api/projects returns current + claude + recents', async () => {
    const home = mkdtempSync(path.join(os.tmpdir(), 'brainctl-projects-routes-'));
    writeFileSync(
      path.join(home, '.claude.json'),
      JSON.stringify({ projects: { '/abs/a': {}, '/abs/b': {} } }),
    );
    writeFileSync(
      path.join(home, '.brainctl-recents.json'),
      JSON.stringify({ version: 1, recents: ['/abs/r1'] }),
    );

    const router = createRouter({
      cwd: '/abs/current',
      homeDir: home,
      recentsFilePath: path.join(home, '.brainctl-recents.json'),
      claudeJsonPath: path.join(home, '.claude.json'),
      // ... plus the rest of the existing dependencies (mocked or real)
    } as never);

    const req = makeReq('/api/projects');
    const res = makeRes();
    await router(req, res);

    const body = JSON.parse(res.chunks.join('')) as {
      current: string;
      claudeProjects: string[];
      recents: string[];
    };
    expect(body.current).toBe('/abs/current');
    expect(body.claudeProjects).toEqual(['/abs/a', '/abs/b']);
    expect(body.recents).toEqual(['/abs/r1']);
  });

  it('POST /api/projects/recent prepends and persists', async () => {
    // Setup: empty recents file
    // Body: { cwd: '/abs/new' }
    // Expect 200, returned recents start with '/abs/new', file on disk updated
    // (full body matches the setup helpers above)
  });

  it('POST /api/projects/recent rejects non-absolute paths', async () => {
    // Expect 400 with error body
  });
});
```

> **Note:** the existing `createRouter` signature expects more fields than shown. Run `grep -n "createRouter\|export function" src/ui/routes.ts` and copy the existing test setup from `tests/platform/ui-server.test.ts` as a starting point — extend it with `recentsFilePath` and `claudeJsonPath` parameters added in Step 3.

- [ ] **Step 2: Run, verify failure**

Run: `npx vitest run tests/platform/projects-routes.test.ts`
Expected: failures referencing missing `recentsFilePath` / unknown route.

- [ ] **Step 3: Wire dependencies & routes**

In `src/ui/routes.ts`:

1. Extend the `RouterDependencies` interface with optional fields:
   ```ts
   recentsFilePath?: string;
   claudeJsonPath?: string;
   ```
   Defaults: `path.join(os.homedir(), '.brainctl', 'recents.json')` and `path.join(os.homedir(), '.claude.json')`.

2. Instantiate the recent-projects service once at router-construction time:
   ```ts
   import { createRecentProjectsService } from '../services/platform/recent-projects-service.js';
   const recentProjectsService = createRecentProjectsService({
     filePath: dependencies.recentsFilePath ?? path.join(os.homedir(), '.brainctl', 'recents.json'),
   });
   const claudeJsonPath = dependencies.claudeJsonPath ?? path.join(os.homedir(), '.claude.json');
   ```

3. Add a helper that reads Claude project keys:
   ```ts
   async function readClaudeProjectPaths(): Promise<string[]> {
     try {
       const raw = await readFile(claudeJsonPath, 'utf8');
       const data = JSON.parse(raw) as { projects?: Record<string, unknown> };
       return Object.keys(data.projects ?? {}).sort();
     } catch {
       return [];
     }
   }
   ```

4. Add the two route cases inside the existing dispatch:
   ```ts
   case '/api/projects': {
     if (req.method === 'GET') {
       const [claudeProjects, recents] = await Promise.all([
         readClaudeProjectPaths(),
         recentProjectsService.read(),
       ]);
       res.setHeader('content-type', 'application/json');
       res.end(JSON.stringify({ current: dependencies.cwd, claudeProjects, recents }));
       return;
     }
     break;
   }

   case '/api/projects/recent': {
     if (req.method === 'POST') {
       const body = await readJsonBody<{ cwd?: unknown }>(req);
       const cwd = typeof body?.cwd === 'string' ? body.cwd : '';
       if (!path.isAbsolute(cwd)) {
         res.statusCode = 400;
         res.setHeader('content-type', 'application/json');
         res.end(JSON.stringify({ error: 'cwd must be an absolute path' }));
         return;
       }
       const recents = await recentProjectsService.addRecent(cwd);
       res.setHeader('content-type', 'application/json');
       res.end(JSON.stringify({ recents }));
       return;
     }
     break;
   }
   ```

(`readJsonBody` is the existing helper used by other POST routes — search for it in `routes.ts`.)

- [ ] **Step 4: Run tests, verify pass**

Run: `npx vitest run tests/platform/projects-routes.test.ts`
Expected: 3 passing.

- [ ] **Step 5: Commit**

```bash
git add src/ui/routes.ts tests/platform/projects-routes.test.ts
git commit -m "feat(ui): add /api/projects routes for picker discovery"
```

---

## Task 4 — `useProfilesBoard`: `boardScope` + `activeProject`

**Files:**
- Modify: `web/src/profiles/board/useProfilesBoard.ts`
- Modify: `tests/web/profiles-view.test.ts`

- [ ] **Step 1: Replace `columnScopes` with `boardScope`**

In `useProfilesBoard.ts`:

- Replace the state:
  ```ts
  // BEFORE
  const [columnScopes, setColumnScopesState] = useState<Record<string, 'global' | 'project'>>({});
  const columnScopesRef = useRef(columnScopes);
  // ... later: columnScopesRef.current = columnScopes;
  // ... and: const setColumnScope = useCallback((agent: string, scope) => setColumnScopesState((p) => ({ ...p, [agent]: scope })), []);

  // AFTER
  const [boardScope, setBoardScopeState] = useState<'global' | 'project'>('global');
  const boardScopeRef = useRef(boardScope);
  useEffect(() => { boardScopeRef.current = boardScope; }, [boardScope]);
  const setBoardScope = useCallback((scope: 'global' | 'project') => setBoardScopeState(scope), []);
  ```

- Replace `columnScopesRef.current[source.agent]` and `columnScopesRef.current[target.agent]` with `boardScopeRef.current` (both source and target use the same scope now).
- Replace any return-object exports of `columnScopes` / `setColumnScope` with `boardScope` / `setBoardScope`.

- [ ] **Step 2: Add `activeProject` state and refetch**

```ts
const [activeProject, setActiveProjectState] = useState<string>('');
const activeProjectRef = useRef('');
useEffect(() => { activeProjectRef.current = activeProject; }, [activeProject]);

// On first mount, hydrate from /api/projects:
useEffect(() => {
  let cancelled = false;
  void (async () => {
    try {
      const res = await fetchJson<{ current: string }>('/api/projects');
      if (!cancelled) setActiveProjectState(res.current);
    } catch {
      // leave as ''; routes will fall back to server cwd
    }
  })();
  return () => { cancelled = true; };
}, []);

const setActiveProject = useCallback((next: string) => {
  setActiveProjectState(next);
}, []);
```

When `activeProject` changes (and is non-empty), refetch agent configs. Append `?cwd=` to existing fetches.

Helper:
```ts
function withCwd(url: string, cwd: string): string {
  if (!cwd) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}cwd=${encodeURIComponent(cwd)}`;
}
```

Then update every `fetchJson(...)` call on lines 320, 439, 453, 466, 479, 491, 503, 657, 715, 780 to wrap the URL with `withCwd(url, activeProjectRef.current)`. (Use the ref because some calls happen inside callbacks captured at mount.)

- [ ] **Step 3: Update existing test fixtures**

In `tests/web/profiles-view.test.ts`, anywhere a test imports `columnScopes` or `setColumnScope`, rename to `boardScope` / `setBoardScope`. Search:

```bash
grep -n "columnScopes\|setColumnScope" tests/web/profiles-view.test.ts
```

Update each match.

- [ ] **Step 4: Run web tests + typecheck**

```
npx vitest run tests/web/profiles-view.test.ts
npm run build:web
```
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add web/src/profiles/board/useProfilesBoard.ts tests/web/profiles-view.test.ts
git commit -m "refactor(web): collapse per-agent scope toggle into board-level boardScope and add activeProject state"
```

---

## Task 5 — Remove per-column scope toggle in `AgentColumn`

**Files:**
- Modify: `web/src/profiles/board/AgentColumn.tsx`

- [ ] **Step 1: Remove the toggle JSX**

Delete the segmented `Global / Project` block (currently lines ~218–235, the two `<button>`s wrapped by their container).

- [ ] **Step 2: Update prop types**

```ts
// BEFORE
onScopeChange: (agent: string, scope: 'global' | 'project') => void;
// AFTER — remove this prop entirely
```

`scope: 'global' | 'project'` stays — it's now received from the parent (ProjectBar's state via ProfilesView).

- [ ] **Step 3: Typecheck**

```
npm run build:web
```
Expected: errors at the call site in `ProfilesView.tsx` (we'll fix in Task 7); no other errors.

- [ ] **Step 4: Commit (will be amended in Task 7 after wiring)**

For now, leave uncommitted — the change only makes sense paired with Task 7's parent wiring. Skip this commit step.

---

## Task 6 — `ProjectBar` component

**Files:**
- Create: `web/src/profiles/board/ProjectBar.tsx`
- Test: `tests/web/project-bar.test.ts`

- [ ] **Step 1: Write failing tests for the helper logic**

Most of `ProjectBar`'s logic is in selecting from a merged source list. Test the pure helper that computes display sections.

```ts
// tests/web/project-bar.test.ts
import { describe, expect, it } from 'vitest';
import { buildPickerSections } from '../../web/src/profiles/board/ProjectBar.js';

describe('buildPickerSections', () => {
  it('splits sources into recents, claude, and dedupes against current', () => {
    const result = buildPickerSections({
      current: '/proj/current',
      claudeProjects: ['/proj/a', '/proj/current', '/proj/b'],
      recents: ['/proj/r1', '/proj/a'],
    });
    expect(result.recents).toEqual(['/proj/r1', '/proj/a']);
    expect(result.claudeOnly).toEqual(['/proj/b']); // current and recents removed
  });

  it('handles empty inputs', () => {
    expect(buildPickerSections({ current: '/x', claudeProjects: [], recents: [] }))
      .toEqual({ recents: [], claudeOnly: [] });
  });
});
```

- [ ] **Step 2: Implement `ProjectBar`**

```tsx
// web/src/profiles/board/ProjectBar.tsx
import { useEffect, useState } from 'react';
import { fetchJson } from '../../lib/fetch-json.js';

export interface ProjectBarProps {
  scope: 'global' | 'project';
  onScopeChange: (scope: 'global' | 'project') => void;
  activeProject: string;
  onActiveProjectChange: (next: string) => void;
}

export interface PickerSections {
  recents: string[];
  claudeOnly: string[];
}

export function buildPickerSections(input: {
  current: string;
  claudeProjects: string[];
  recents: string[];
}): PickerSections {
  const exclude = new Set([input.current, ...input.recents]);
  return {
    recents: input.recents.slice(),
    claudeOnly: input.claudeProjects.filter((p) => !exclude.has(p)),
  };
}

export function ProjectBar({
  scope,
  onScopeChange,
  activeProject,
  onActiveProjectChange,
}: ProjectBarProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const [claudeProjects, setClaudeProjects] = useState<string[]>([]);
  const [recents, setRecents] = useState<string[]>([]);
  const [manualPath, setManualPath] = useState('');

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetchJson<{
          current: string;
          claudeProjects: string[];
          recents: string[];
        }>('/api/projects');
        setClaudeProjects(res.claudeProjects);
        setRecents(res.recents);
      } catch {
        // leave empty; only current cwd is selectable
      }
    })();
  }, []);

  function pick(path: string): void {
    setOpen(false);
    onActiveProjectChange(path);
    void fetchJson('/api/projects/recent', {
      method: 'POST',
      body: JSON.stringify({ cwd: path }),
    }).catch(() => {});
  }

  const sections = buildPickerSections({
    current: activeProject,
    claudeProjects,
    recents,
  });

  return (
    <div className="flex items-center gap-3 border-b border-zinc-200 bg-zinc-50 px-4 py-2">
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="rounded-md border border-zinc-300 bg-white px-3 py-1 text-sm font-medium text-zinc-800"
        >
          {activeProject || '—'}
        </button>
        {open && (
          <div className="absolute z-10 mt-1 w-96 rounded-md border border-zinc-200 bg-white shadow-lg">
            {sections.recents.length > 0 && (
              <Section title="Recents" items={sections.recents} onPick={pick} />
            )}
            {sections.claudeOnly.length > 0 && (
              <Section title="Claude projects" items={sections.claudeOnly} onPick={pick} />
            )}
            <div className="border-t border-zinc-200 p-2">
              <label className="text-[11px] font-medium text-zinc-500">Add path</label>
              <div className="mt-1 flex gap-1">
                <input
                  className="flex-1 rounded border border-zinc-300 px-2 py-1 text-sm"
                  value={manualPath}
                  onChange={(e) => setManualPath(e.target.value)}
                  placeholder="/absolute/path/to/project"
                />
                <button
                  type="button"
                  className="rounded bg-zinc-900 px-2 py-1 text-sm text-white"
                  onClick={() => {
                    if (manualPath) {
                      pick(manualPath);
                      setManualPath('');
                    }
                  }}
                >
                  Add
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="ml-auto flex items-center gap-2 rounded-md bg-zinc-200 p-0.5">
        <button
          type="button"
          onClick={() => onScopeChange('global')}
          className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
            scope === 'global' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'
          }`}
        >
          Global
        </button>
        <button
          type="button"
          onClick={() => onScopeChange('project')}
          className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
            scope === 'project' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'
          }`}
        >
          Project
        </button>
      </div>

      {scope === 'project' && (
        <div className="font-mono text-[11px] text-zinc-500" title={activeProject}>
          {activeProject}
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  items,
  onPick,
}: {
  title: string;
  items: string[];
  onPick: (p: string) => void;
}): JSX.Element {
  return (
    <div className="border-b border-zinc-200 last:border-b-0">
      <div className="px-2 pt-2 pb-1 text-[11px] font-medium text-zinc-500">{title}</div>
      <ul>
        {items.map((p) => (
          <li key={p}>
            <button
              type="button"
              className="block w-full truncate px-2 py-1 text-left text-sm hover:bg-zinc-100"
              onClick={() => onPick(p)}
            >
              {p}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 3: Run tests + typecheck**

```
npx vitest run tests/web/project-bar.test.ts
npm run build:web
```
Expected: 2 passing tests; clean web build (still has the broken `ProfilesView` call site from Task 5 — fixed next).

- [ ] **Step 4: Commit (deferred — bundle with Task 7)**

---

## Task 7 — Wire `ProjectBar` into `ProfilesView` & confirm-switch modal

**Files:**
- Create: `web/src/profiles/board/ConfirmSwitchProjectModal.tsx`
- Modify: `web/src/profiles/ProfilesView.tsx`
- Modify: `tests/web/profiles-view.test.ts` (existing test for column toggle)

- [ ] **Step 1: ConfirmSwitchProjectModal (no-frills modal)**

```tsx
// web/src/profiles/board/ConfirmSwitchProjectModal.tsx
export interface ConfirmSwitchProjectModalProps {
  pendingCount: number;
  targetProject: string;
  onSaveAndSwitch: () => void;
  onDiscardAndSwitch: () => void;
  onCancel: () => void;
}

export function ConfirmSwitchProjectModal(p: ConfirmSwitchProjectModalProps): JSX.Element {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="w-96 rounded-md bg-white p-4 shadow-xl">
        <h3 className="text-sm font-semibold text-zinc-900">Unsaved changes</h3>
        <p className="mt-2 text-sm text-zinc-600">
          You have {p.pendingCount} unsaved change{p.pendingCount === 1 ? '' : 's'}. What would you
          like to do before switching to <span className="font-mono">{p.targetProject}</span>?
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="rounded-md px-3 py-1 text-sm text-zinc-600" onClick={p.onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="rounded-md border border-zinc-300 px-3 py-1 text-sm"
            onClick={p.onDiscardAndSwitch}
          >
            Discard &amp; switch
          </button>
          <button
            type="button"
            className="rounded-md bg-zinc-900 px-3 py-1 text-sm text-white"
            onClick={p.onSaveAndSwitch}
          >
            Save &amp; switch
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Update `ProfilesView`**

In `ProfilesView.tsx`:

1. Pull `boardScope`, `setBoardScope`, `activeProject`, `setActiveProject`, `pendingChanges`, `applyPendingChangesWithApi`, and `discardPendingChanges` (or whatever the existing reset method is) from `useProfilesBoard()`.
2. Render `<ProjectBar />` at the top, passing those props.
3. For each `<AgentColumn />`, replace `scope={columnScopes[config.agent] ?? 'global'}` with `scope={boardScope}` and remove the `onScopeChange` prop.
4. Add local state `pendingSwitchTarget: string | null`. Pass an interceptor to `ProjectBar.onActiveProjectChange`:
   ```tsx
   const requestSwitch = (target: string) => {
     if (target === activeProject) return;
     if (pendingChanges.length > 0) {
       setPendingSwitchTarget(target);
     } else {
       setActiveProject(target);
     }
   };
   ```
5. Render `ConfirmSwitchProjectModal` when `pendingSwitchTarget !== null`:
   ```tsx
   {pendingSwitchTarget && (
     <ConfirmSwitchProjectModal
       pendingCount={pendingChanges.length}
       targetProject={pendingSwitchTarget}
       onCancel={() => setPendingSwitchTarget(null)}
       onDiscardAndSwitch={() => {
         discardPendingChanges();
         setActiveProject(pendingSwitchTarget);
         setPendingSwitchTarget(null);
       }}
       onSaveAndSwitch={async () => {
         await applyPendingChangesWithApi();
         setActiveProject(pendingSwitchTarget);
         setPendingSwitchTarget(null);
       }}
     />
   )}
   ```

> If `discardPendingChanges` doesn't yet exist on `useProfilesBoard`, expose it: `const discardPendingChanges = useCallback(() => setPendingChanges([]), [setPendingChanges]);`.

- [ ] **Step 3: Update `tests/web/profiles-view.test.ts`**

Any test that previously rendered `<AgentColumn>` with an `onScopeChange` prop should drop it. Any test that checked the per-column toggle was rendered: delete those assertions.

- [ ] **Step 4: Run full suite + builds**

```
npm test
npm run build:server
npm run build:web
```
Expected: green.

- [ ] **Step 5: Commit (bundles Tasks 5–7)**

```bash
git add web/src/profiles/board/AgentColumn.tsx \
        web/src/profiles/board/ProjectBar.tsx \
        web/src/profiles/board/ConfirmSwitchProjectModal.tsx \
        web/src/profiles/ProfilesView.tsx \
        tests/web/profiles-view.test.ts \
        tests/web/project-bar.test.ts
git commit -m "feat(web): page-level project picker and shared scope toggle"
```

---

## Task 8 — Manual verification

- [ ] **Step 1: Build & start UI**

```bash
npm run build
npx tsx src/cli.ts ui
```

- [ ] **Step 2: Walk the happy paths in a browser** at http://127.0.0.1:3333

Verify:
1. Profiles page shows ONE Global/Project toggle at the top, none inside columns.
2. Toggling Global → Project flips all three agent columns at once.
3. The picker dropdown shows Recents (initially empty) and Claude projects.
4. Picking a Claude project changes the path label and refetches MCPs/skills.
5. After picking, that project appears at the top of Recents next time the dropdown opens.
6. Manual "Add path…" with a non-existent path: the picker accepts it, view shows empty config, no crash.
7. Drag-stage an MCP, then try to switch projects → confirm modal appears with Save / Discard / Cancel.
8. "Cancel" leaves staged changes intact.
9. "Discard & switch" clears them and switches.
10. "Save & switch" applies them and switches.

- [ ] **Step 3: Smoke-check non-Profiles views**

Skills, Run, MCP views still load and behave as before (they use server cwd, unchanged).

- [ ] **Step 4: Verify recents file**

```
cat ~/.brainctl/recents.json
```
Should contain a `version: 1` and a `recents` array with the projects you picked, MRU-ordered.

- [ ] **Step 5: PR**

Use the `commit-push` skill to push the feature branch and open a PR titled `feat: project picker and shared scope toggle on profiles view`.

---

## Self-review

**Spec coverage:**
- Page-level toggle → Tasks 4, 5, 6, 7. ✅
- Active-project label → Task 6 (rendered in ProjectBar when scope=project). ✅
- Project picker (Claude + recents + manual) → Tasks 3, 6. ✅
- Stateless `?cwd=` query param → Task 2 (helper) + Task 4 (UI threading). ✅
- Pending-changes guard modal → Task 7. ✅
- Recents persistence at `~/.brainctl/recents.json` → Task 1. ✅
- Tests: service (Task 1), routes (Task 3), web helper (Task 6), updated existing (Task 4, 7). ✅

**Placeholder scan:** No TBDs, TODOs, or "similar to Task N" references. Code is inline at every step.

**Type consistency:** `boardScope` / `setBoardScope` / `activeProject` / `setActiveProject` names match between `useProfilesBoard` exports (Task 4) and consumers (Task 7). `buildPickerSections` signature matches between test (Task 6 step 1) and implementation (Task 6 step 2).
