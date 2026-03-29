# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is brainctl?

A CLI tool that manages repeatable AI environments across multiple agent tools (Claude, Codex). It loads an `ai-stack.yaml` config, assembles unified context from memory (markdown files) + skill (prompt) + input, then executes through agent CLIs as subprocesses.

## Commands

```bash
npm test              # Run all tests (vitest)
npm run build         # Build server (tsc) + web (vite)
npm run build:server  # TypeScript only
npm run build:web     # React dashboard only
npm run dev -- <args> # Run CLI via tsx (e.g., npm run dev -- run review input.md)
```

Run a single test file: `npx vitest run tests/config.test.ts`

## Architecture

**Core flow:** `ai-stack.yaml` → load memory paths → resolve skill prompt → build context string → spawn agent CLI → return output/exit code.

### Layers

- **Commands** (`src/commands/`) — Commander handlers that parse CLI args and delegate to services
- **Services** (`src/services/`) — Business logic (run, init, status, doctor, config-write). Accept injected dependencies for testability
- **Context** (`src/context/`) — Memory loader (reads markdown files from configured paths), skill resolver, and context builder that assembles the `--- MEMORY ---\n--- SKILL ---\n--- INPUT ---` format
- **Executor** (`src/executor/`) — `Executor` interface with Claude/Codex implementations. `ExecutorResolver` checks agent availability (`which`) and caches results. Agents are spawned as child processes
- **UI** (`src/ui/` + `web/`) — Express-like HTTP server with SSE streaming for a React dashboard. Routes serve the Vite-built SPA and expose API endpoints for config/runs

### Key conventions

- All source is ESM (`"type": "module"`) — use `.js` extensions in imports even for TypeScript files
- Error hierarchy: `BrainctlError` base class with `category: 'user' | 'system'` and error `code`. User errors get friendly CLI output; system errors indicate bugs
- Service constructors accept optional dependency overrides (resolver, config loader) — tests inject mocks this way
- Config file is always `ai-stack.yaml` in the working directory
- The `Executor` interface: `run(context: string, options?: ExecutorRunOptions): Promise<ExecutorResult>` with optional streaming via `onOutputChunk` callback
