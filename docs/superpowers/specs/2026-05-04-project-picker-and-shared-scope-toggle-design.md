# Project picker & shared scope toggle

**Date:** 2026-05-04
**Status:** Draft
**Owner:** roro

## Problem

The Profiles view added a per-agent Global/Project scope toggle in #27, but the experience has two gaps:

1. **No visible project context.** "Project scope" is implicitly tied to the directory the `brainctl ui` process was launched from (its `process.cwd()`), but the UI never tells the user which project that is. Users assume there should be a picker and feel something is missing.
2. **Per-column scope toggles are confusing.** Each agent column carries its own `Global / Project` toggle, so flipping Claude's column does not affect Codex or Gemini. In practice users want to view the whole board in one scope at a time.

## Goals

- Surface the active project clearly, including its full path.
- Let users switch the active project from inside the UI without restarting `brainctl ui`.
- Replace the three per-column scope toggles with one shared board-level toggle.
- Keep the change scoped to the Profiles view; do not change Skills/Run/MCP/etc. semantics in this pass.

## Non-goals

- Mining Codex sessions or Gemini history for project paths. (Lossy and fragile; see "Project discovery" below.)
- Multi-project simultaneous editing in a single tab.
- A full project-management UI (rename, delete, archive). The picker just selects which existing path is "active".

## High-level design

A new `ProjectBar` component sits at the top of `ProfilesView` and owns:

- A **project picker** combobox.
- A single **Global / Project** segmented toggle.
- A label showing the resolved active project path (full path, monospace).

`useProfilesBoard` state changes:

- `columnScopes: Record<string, 'global' | 'project'>` → `boardScope: 'global' | 'project'` (single shared value).
- Add `activeProject: string` (initialized from `GET /api/status` once on mount).

All profile-related API requests include `?cwd=<activeProject>`. The UI server uses that path; if absent it falls back to `process.cwd()` for backward compatibility with non-UI MCP callers.

## Components

### `ProjectBar` (new — `web/src/profiles/board/ProjectBar.tsx`)

Layout (left to right):
- Picker combobox: shows truncated current path, opens dropdown on click.
- Global / Project segmented toggle (existing styling reused from `AgentColumn`).
- Inline path label, full path, only shown when scope is `project` (the path is what makes "project" meaningful).

Picker dropdown sections, top to bottom:
1. **Recents** (brainctl) — most-recently-used first, max 5 visible with "Show all" expand.
2. **Claude projects** — sorted alphabetically by basename, full path on hover.
3. **Add path…** — text input + Add button. On submit, validates the path exists, adds it to recents, sets it active.

Selection behavior: clicking a path sets it active and bumps it to the top of recents.

### `ProjectPicker` is part of `ProjectBar`

We do not need a separately reusable picker yet. If a second consumer appears later, extract it. (YAGNI.)

### `AgentColumn` changes

- Remove the inline `Global / Project` toggle (lines 221–232 today).
- Accept `scope: 'global' | 'project'` from props (already does); stop accepting `onScopeChange`.

### `useProfilesBoard` changes

- Replace `columnScopes` state and `setColumnScope` callback with `boardScope` state and `setBoardScope` callback.
- Add `activeProject` state and `setActiveProject` callback. Switching project triggers a refetch of agent configs and clears nothing automatically (see "Switching projects with staged changes" below).
- Drag-staging that previously read `columnScopesRef.current[agent]` now reads `boardScopeRef.current`.
- All `fetchJson` calls under profile API endpoints append `?cwd=<encodeURIComponent(activeProject)>`.

## Server-side

### Stateless `?cwd=` parameter

Profile-related routes in `src/ui/routes.ts` already operate against an injected cwd through the service layer; the routes today pass `process.cwd()`. Change them to read `cwd` from the query string and fall back to `process.cwd()` when missing or when the param fails validation.

Validation: must be an absolute path. Existence is **not** required at the API layer — the user might be staging an empty new project. UI shows a warning if the path doesn't exist.

Affected routes (all gain optional `?cwd=`):
- `GET /api/profiles/agents`
- `POST /api/agents/:agent/mcps`
- `DELETE /api/agents/:agent/mcps/:key`
- `POST /api/agents/:agent/skills/*`
- Any other route that calls into `agentConfigService.readAll`/`addMcp`/`removeMcp`.

A small helper `resolveCwd(req)` returns the validated cwd or `process.cwd()`.

### New routes

- `GET /api/projects` →
  ```json
  {
    "current": "/abs/path",
    "claudeProjects": ["/abs/path/a", "/abs/path/b"],
    "recents": ["/abs/path/x", "/abs/path/y"]
  }
  ```
  Sources:
  - `current` = process.cwd() of the UI server (the "default" project).
  - `claudeProjects` = keys of `~/.claude.json → projects`, filtered to those that still exist on disk, sorted alphabetically by basename.
  - `recents` = `~/.brainctl/recents.json` content, MRU-ordered. Created lazily.

- `POST /api/projects/recent` body `{ "cwd": "/abs/path" }`:
  - Validates absolute path.
  - Adds (or moves to top of) the recents list.
  - Caps recents at 20 entries.
  - Returns the updated recents array.

### Recent-projects service

New `src/services/platform/recent-projects-service.ts` factory `createRecentProjectsService({ filePath?, fs? })`:
- `read(): Promise<string[]>` — returns recents (empty if file missing).
- `addRecent(cwd: string): Promise<string[]>` — dedupes, MRU, caps 20, atomic write.
- File: `~/.brainctl/recents.json`, format `{ "version": 1, "recents": ["/abs", ...] }`.

Atomic write follows the existing pattern (temp + rename + `.bak.*`).

## Switching projects with staged changes

When the user picks a new project while `pendingChanges.length > 0`, show a modal with three actions:

- **Save & switch** — runs `applyPendingChangesWithApi` first (against the *current* cwd), then on success switches and refetches.
- **Discard & switch** — clears `pendingChanges`, switches, refetches.
- **Cancel** — closes the modal, no state change.

Implementation: a small `ConfirmSwitchProjectModal` component owned by `ProfilesView`, gated by `pendingChanges.length`. If there are no pending changes, switching is immediate.

## Data flow on project switch

1. User selects new path in picker.
2. If pending changes exist → modal (above). Otherwise continue.
3. `setActiveProject(newPath)` updates state.
4. Effect detects change, calls `GET /api/profiles/agents?cwd=<newPath>`.
5. Board re-renders against the new `agentConfigs`.
6. `POST /api/projects/recent` fires-and-forgets to bump the recents list.

## Error handling

- `GET /api/projects` failure: picker still works, just shows only the current cwd. Surface a small inline notice.
- `POST /api/projects/recent` failure: silent; don't block UX. Logged via existing client error handler.
- API request with an invalid `cwd` query param: server falls back to `process.cwd()` and includes a `X-Brainctl-CWD-Fallback: 1` response header for debug.
- Picking a nonexistent path: warn inline ("Path does not exist on disk"), but still allow operating on it (matches Claude's own behavior — `~/.claude.json` retains stale project keys).

## Testing

Unit tests:
- `recent-projects-service.test.ts` — read/empty, add/dedupe/cap, atomic write.
- `routes.test.ts` (extension) — `?cwd=` honored, falls back to process.cwd() on missing/invalid; `GET /api/projects` shape; `POST /api/projects/recent` validates and persists.
- `useProfilesBoard.test.ts` (extension) — `boardScope` replaces `columnScopes`; staged-changes guard fires on project switch.

Component-level smoke (existing patterns):
- `ProfilesView` renders `ProjectBar` once; column toggles gone.
- `ProjectBar` lists current + claude + recents + manual input.

No new e2e tests in this pass.

## Migration notes

- Removing per-column toggle is a UI-only change; no persisted state to migrate.
- Existing data in `~/.claude.json → projects` is read-only input — no risk to it.
- `~/.brainctl/recents.json` is created lazily; absent file is normal.

## Open questions

None blocking. Future work could include:
- Pinning favorite projects above recents.
- Auto-trim recents whose path no longer exists.
- Surfacing the active project in non-Profiles views (Skills/Run/MCP).
