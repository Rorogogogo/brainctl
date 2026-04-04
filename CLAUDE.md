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
- **Services** (`src/services/`) — Business logic (run, init, status, doctor, config-write, agent-config, profile, sync). Accept injected dependencies for testability
  - `agent-config-service.ts` — Reads/writes live agent configs (MCPs + skills) with atomic writes + backups
  - `sync/agent-reader.ts` — Readers for each agent's config files, returns normalized `AgentLiveConfig`
  - `sync/agent-writer.ts` — Writers for syncing profile configs to agent files
- **Context** (`src/context/`) — Memory loader (reads markdown files from configured paths), skill resolver, and context builder that assembles the `--- MEMORY ---\n--- SKILL ---\n--- INPUT ---` format
- **Executor** (`src/executor/`) — `Executor` interface with Claude/Codex implementations. `ExecutorResolver` checks agent availability (`which`) and caches results. Agents are spawned as child processes
- **MCP Server** (`src/mcp/server.ts`) — FastMCP server exposing 22 tools (skills, run, status, doctor, memory, profiles, sync, agent configs, UI control)
- **UI** (`src/ui/` + `web/`) — HTTP server with SSE streaming for a React dashboard (Vite + @dnd-kit). Routes serve the SPA and expose REST API endpoints

### Web UI

- **Profiles page** — 3-column layout (Claude, Codex, Gemini) showing live MCPs + skills from each agent's config files
- **Drag & drop** — @dnd-kit with `pointerWithin` collision detection and `snapToPointer` modifier. Dragging stages changes locally; Save & apply writes to agent configs
- **Staged changes pattern** — `PendingChange[]` with `category: 'mcp' | 'skill'`, previewed before commit. Changes are applied atomically (temp file + rename + backup)

### Key conventions

- All source is ESM (`"type": "module"`) — use `.js` extensions in imports even for TypeScript files
- Error hierarchy: `BrainctlError` base class with `category: 'user' | 'system'` and error `code`. User errors get friendly CLI output; system errors indicate bugs
- Service constructors accept optional dependency overrides (resolver, config loader) — tests inject mocks this way
- Config file is always `ai-stack.yaml` in the working directory
- The `Executor` interface: `run(context: string, options?: ExecutorRunOptions): Promise<ExecutorResult>` with optional streaming via `onOutputChunk` callback
- Agent config mutations use atomic writes (temp + rename) with timestamped `.bak.*` backups
