# Brainctl MVP Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a distributable TypeScript CLI MVP for `brainctl` with config loading, memory and skill resolution, context building, strict agent execution with optional fallback, diagnostics commands, and focused tests.

**Architecture:** Use `commander` with thin command modules over service-layer orchestration. Keep config, memory, skills, context building, executor resolution, and agent process execution in isolated modules with typed errors and clear result objects.

**Tech Stack:** Node.js, TypeScript, commander, yaml, picocolors, vitest

---

### Task 1: Scaffold project tooling

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `src/`

**Step 1: Add package metadata and scripts**

Add scripts for `build`, `test`, and `dev`, plus a `bin` entry for `brainctl`.

**Step 2: Add TypeScript and test configuration**

Configure Node-targeted TypeScript output to `dist/` and Vitest for Node tests.

**Step 3: Run dependency install and baseline test command**

Run: `npm install`
Expected: dependencies install successfully

Run: `npm test`
Expected: no tests or failing tests until behavior is added

### Task 2: Add shared types and errors

**Files:**
- Create: `src/types.ts`
- Create: `src/errors.ts`

**Step 1: Define config, agent, memory, execution, and diagnostic types**

Include `ExecutionStep`, `ExecutionTrace`, `ExecutorResult`, and error categories.

**Step 2: Add typed error classes**

Create `ConfigError`, `ValidationError`, `MemoryPathError`, `SkillNotFoundError`, `InputFileError`, `AgentNotAvailableError`, and `ExecutionError`.

### Task 3: Write failing tests for context building and config loading

**Files:**
- Create: `tests/context-builder.test.ts`
- Create: `tests/config.test.ts`

**Step 1: Add context-builder expectations**

Verify the prompt format exactly matches the required section layout.

**Step 2: Add config parsing tests**

Verify valid parsing and failures for missing required config fields.

**Step 3: Run tests and verify failures**

Run: `npm test -- context-builder config`
Expected: failures because implementation is missing

### Task 4: Implement config and context builder

**Files:**
- Create: `src/config.ts`
- Create: `src/context/builder.ts`

**Step 1: Implement exact prompt formatting**

Build `buildContext({ memory, skill, input }) => string`.

**Step 2: Implement YAML loading and validation**

Parse `ai-stack.yaml`, normalize memory paths, and default empty `mcps`.

**Step 3: Re-run focused tests**

Run: `npm test -- context-builder config`
Expected: tests pass

### Task 5: Write failing tests for memory and skills

**Files:**
- Create: `tests/memory.test.ts`
- Create: `tests/skills.test.ts`

**Step 1: Add memory loader tests**

Verify deterministic loading of multiple markdown files and empty-directory behavior.

**Step 2: Add skill loader tests**

Verify resolving configured skills and missing-skill failure.

**Step 3: Run tests and verify failures**

Run: `npm test -- memory skills`
Expected: failures because loaders are missing

### Task 6: Implement memory and skill loaders

**Files:**
- Create: `src/context/memory.ts`
- Create: `src/context/skills.ts`

**Step 1: Implement recursive markdown discovery**

Return `{ content, files, count }` with deterministic sorting.

**Step 2: Implement skill resolution**

Return the prompt for a named skill or throw `SkillNotFoundError`.

**Step 3: Re-run focused tests**

Run: `npm test -- memory skills`
Expected: tests pass

### Task 7: Write failing tests for run orchestration

**Files:**
- Create: `tests/run-cli.test.ts`

**Step 1: Add CLI integration test**

Create a temporary project, instantiate the CLI with real services and a mocked executor, run `brainctl run`, and assert that the built context reaches the executor.

**Step 2: Run the integration test and verify failure**

Run: `npm test -- run-cli`
Expected: failure because execution services and CLI are missing

### Task 8: Implement executors and resolver

**Files:**
- Create: `src/executor/types.ts`
- Create: `src/executor/claude.ts`
- Create: `src/executor/codex.ts`
- Create: `src/executor/resolver.ts`

**Step 1: Define the executor contract**

Support streaming output while capturing it internally and returning structured results.

**Step 2: Implement Claude and Codex executors**

Wrap `child_process.spawn` with stdin context input, stdout/stderr streaming, and captured output.

**Step 3: Implement resolver and availability checks**

Centralize supported agents, executable lookup, caching, and availability reporting.

### Task 9: Implement services and commands

**Files:**
- Create: `src/services/init-service.ts`
- Create: `src/services/run-service.ts`
- Create: `src/services/status-service.ts`
- Create: `src/services/doctor-service.ts`
- Create: `src/commands/init.ts`
- Create: `src/commands/run.ts`
- Create: `src/commands/status.ts`
- Create: `src/commands/doctor.ts`
- Create: `src/cli.ts`

**Step 1: Implement service orchestration**

Keep all workflow logic in services, not command modules.

**Step 2: Implement thin commands**

Parse args and options, call services, print results, and map exit codes.

**Step 3: Re-run the CLI integration test**

Run: `npm test -- run-cli`
Expected: test passes

### Task 10: Add sample project files

**Files:**
- Create: `ai-stack.yaml`
- Create: `memory/notes.md`

**Step 1: Add a sample config**

Include example memory paths, skills, and empty MCP config.

**Step 2: Add sample markdown memory**

Provide a simple memory note for local testing.

### Task 11: Verify the full project

**Files:**
- Verify: all created files

**Step 1: Run test suite**

Run: `npm test`
Expected: all tests pass

**Step 2: Run build**

Run: `npm run build`
Expected: TypeScript compiles to `dist/`

**Step 3: Smoke-check CLI help**

Run: `node dist/cli.js --help`
Expected: command help renders successfully
