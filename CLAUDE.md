# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is brainctl?

A CLI + MCP server + web dashboard that manages AI agent environments across Claude, Codex, and Gemini. It reads/writes live agent configs, provides drag-and-drop skill/MCP management between agents, and can execute skills through agent CLIs as subprocesses.

## Commands

```bash
npm test              # Run all tests (vitest)
npm run build         # Build server (tsc) + web (vite)
npm run build:server  # TypeScript only
npm run build:web     # React dashboard only
npm run dev -- <args> # Run CLI via tsx (e.g., npm run dev -- run review input.md)
npx tsx src/cli.ts ui # Start web dashboard on http://127.0.0.1:3333
```

Run a single test file: `npx vitest run tests/config.test.ts`

## Architecture

### Core flow

`ai-stack.yaml` → load memory paths → resolve skill prompt → build context string → spawn agent CLI → return output/exit code.

### Agent config locations

| Agent  | Config file                     | MCP location                       | Skills location                              |
|--------|---------------------------------|------------------------------------|----------------------------------------------|
| Claude | `~/.claude.json`                | `projects[cwd].mcpServers`         | `~/.claude/plugins/` + `~/.claude/skills/`   |
| Codex  | `~/.codex/config.toml`          | `[mcp_servers.*]` sections         | `~/.codex/skills/` (SKILL.md dirs)           |
| Gemini | `~/.gemini/settings.json`       | `mcpServers` (flat JSON)           | `~/.gemini/skills/` (SKILL.md dirs)          |

### Layers

- **Commands** (`src/commands/`) — Commander handlers that parse CLI args and delegate to services
- **Services** (`src/services/`) — Business logic. All services use a factory pattern (`create*Service()`) that returns a methods object. Factory params accept optional dependency overrides for testability
  - `agent-config-service.ts` — Reads/writes live agent configs (MCPs + skills) with atomic writes + backups
  - `sync/agent-reader.ts` — Readers for each agent's config files, returns normalized `AgentLiveConfig`
  - `sync/agent-writer.ts` — Dispatcher; per-agent writers in `sync/claude-writer.ts`, `sync/codex-writer.ts`, `sync/gemini-writer.ts`
  - `sync/plugin-skill-reader.ts` + `sync/managed-plugin-registry.ts` — Read skills from agent plugin directories
  - Portable profile pipeline: `portable-profile-pack-service.ts` → `credential-redaction-service.ts` → tarball; `profile-import-service.ts` → `credential-resolution-service.ts` → `portable-mcp-classifier.ts` → install
- **Context** (`src/context/`) — Memory loader (reads markdown files from configured paths), skill resolver, and context builder that assembles the `--- MEMORY ---\n--- SKILL ---\n--- INPUT ---` format
- **Executor** (`src/executor/`) — `Executor` interface with Claude/Codex implementations. `ExecutorResolver` checks agent availability (`which`) and caches results. Agents are spawned as child processes
- **MCP Server** (`src/mcp/server.ts`) — FastMCP server exposing 22 tools (skills, run, status, doctor, memory, profiles, sync, agent configs, UI control)
- **UI** (`src/ui/` + `web/`) — Raw `node:http` server (no Express). `routes.ts` is a single handler with URL-based dispatch. SSE streaming for run output. Serves the Vite-built React SPA from `dist/web/`
  - Web views: `ProfilesView` (drag-and-drop agent config), `SkillsView`, `McpView`, `RunView`

### Portable profiles

Profiles can be packed into `.tar.gz` archives for sharing. The archive contains:
- `manifest.yaml` — schema version, pack source, required credential specs
- `profile.yaml` — normalized MCP definitions (each classified as `local`/`remote` via `portable-mcp-classifier.ts`)
- Bundled MCP directories (for `source: bundled` MCPs)

Credentials are redacted to `${credentials.<key>}` placeholders on export and resolved from `--credential key=value` flags on import.

### Data directories

- `ai-stack.yaml` — per-project config (skills, memory paths, MCPs)
- `.brainctl/` — per-project metadata: `meta.yaml` (active profile, agent list), `profiles/` directory with per-profile YAML files

### Web UI

- **Profiles page** — 3-column layout (Claude, Codex, Gemini) showing live MCPs + skills from each agent's config files
- **Drag & drop** — @dnd-kit with `pointerWithin` collision detection and `snapToPointer` modifier. Dragging stages changes locally; Save & apply writes to agent configs
- **Staged changes pattern** — `PendingChange[]` with `category: 'mcp' | 'skill'`, previewed before commit. Changes are applied atomically (temp file + rename + backup)

### Key conventions

- All source is ESM (`"type": "module"`) — use `.js` extensions in imports even for TypeScript files
- Error hierarchy: `BrainctlError` base class with `category: 'user' | 'system'` and error `code` (see `src/errors.ts`). Subclasses: `ConfigError`, `ValidationError`, `ProfileError`, `ProfileNotFoundError`, etc. User errors get friendly CLI output; system errors indicate bugs
- Service factory pattern: `createFooService(deps?)` returns `{ methodA(), methodB() }`. Tests inject mock deps via the optional parameter
- Config file is always `ai-stack.yaml` in the working directory
- The `Executor` interface: `run(context: string, options?: ExecutorRunOptions): Promise<ExecutorResult>` with optional streaming via `onOutputChunk` callback
- Agent config mutations use atomic writes (temp + rename) with timestamped `.bak.*` backups
- MCP server input validation uses Zod schemas
- Web dashboard uses Tailwind CSS v4 (PostCSS plugin, not the older `tailwind.config.js` approach)
