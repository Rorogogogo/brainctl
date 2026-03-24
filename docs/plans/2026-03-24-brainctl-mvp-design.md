# brainctl MVP Design

## Goal

Build a production-quality MVP for `brainctl`, a file-based AI environment manager CLI that provides consistent memory, skills, context building, and agent execution across Claude Code and Codex.

## Scope

The MVP includes:

- File-based markdown memory loaded from configured paths
- YAML-defined skills with prompt templates
- A unified context builder
- Agent execution through external `claude` and `codex` CLIs
- CLI commands: `init`, `status`, `run`, `doctor`
- Typed errors and shared diagnostics
- Focused automated tests with mocked executor behavior

The MVP excludes:

- MCP runtime execution
- Database storage
- Automatic multi-agent orchestration
- Fallback on non-zero agent exit codes

## Architecture

The project uses `commander` with a thin CLI layer and modular services.

- `src/cli.ts` registers commands, parses arguments, and handles exit codes
- `src/commands/*.ts` adapt parsed CLI arguments to service calls
- `src/config.ts` loads and validates `ai-stack.yaml`
- `src/context/builder.ts` formats the unified context prompt
- `src/context/memory.ts` loads markdown memory content deterministically
- `src/context/skills.ts` resolves named skills from config
- `src/executor/*.ts` implement agent-specific process execution
- `src/executor/resolver.ts` centralizes agent availability checks and executor resolution
- `src/services/*.ts` own orchestration for init, run, status, and doctor
- `src/errors.ts` defines typed user and system errors
- `tests/*.test.ts` cover core behavior

## Data Model

### Config

`ai-stack.yaml` is loaded into a typed config shape:

- `memory.paths: string[]`
- `skills: Record<string, { description?: string; prompt: string }>`
- `mcps: Record<string, unknown>`

Relative memory paths are normalized against the current working directory.

### Memory

Memory loading returns:

```ts
{
  content: string;
  files: string[];
  count: number;
}
```

Markdown files are collected recursively from each configured memory path and sorted deterministically by normalized absolute path.

### Execution

The run path is modeled as an execution plan:

```ts
type ExecutionStep = {
  skill: string;
  inputFile: string;
  primaryAgent: AgentName;
  fallbackAgent?: AgentName;
  usePreviousOutput?: boolean;
};
```

The MVP plan contains one step, but the model supports future multi-step workflows.

Execution returns a trace:

```ts
{
  steps: Array<{
    stepIndex: number;
    requestedAgent: AgentName;
    agent: AgentName;
    fallbackUsed: boolean;
    exitCode: number;
    output: string;
  }>;
  finalOutput: string;
  finalExitCode: number;
}
```

## Agent Resolution

Agent support is centralized behind an executor resolver.

- `resolveExecutor(agentName)` validates the agent and checks CLI availability
- `getAgentAvailability()` reports availability for all supported agents
- Availability checks are cached within a single resolver instance
- `status`, `doctor`, and `run` all share this logic

Fallback behavior is strictly defined:

- Try the primary agent first
- If the primary agent is unavailable and a fallback agent is provided, use the fallback
- Do not fallback on execution failures or non-zero exit codes

## Error Model

All expected failures use typed errors with categories:

- `ConfigError`
- `ValidationError`
- `MemoryPathError`
- `SkillNotFoundError`
- `InputFileError`
- `AgentNotAvailableError`
- `ExecutionError`

Each error includes a category:

- `user`: invalid configuration, missing files, unknown skills, unavailable agents
- `system`: process failures, unexpected filesystem issues, unhandled internal failures

The CLI formats these errors consistently and keeps orchestration out of command modules.

## Command Behavior

### `brainctl init`

- Creates `ai-stack.yaml`, `memory/`, and `memory/notes.md` when missing
- Does not overwrite existing files by default
- Supports `--force` to replace existing scaffolded files
- Handles partial initialization by creating only missing components when not forced

### `brainctl status`

Reports:

- number of memory files found
- available skill names
- MCP count
- supported agent availability

### `brainctl run <skill> <file> --with <agent> [--fallback <agent>]`

Flow:

1. Load config
2. Load memory
3. Resolve skill prompt
4. Read input file
5. Build context
6. Build the execution plan
7. Resolve the primary executor or fallback if primary is unavailable
8. Execute while streaming output and capturing it internally
9. Return the execution trace and final exit code

### `brainctl doctor`

Checks:

- config file exists
- memory paths exist
- at least one skill exists
- supported agents are installed

Warnings and failures are surfaced clearly.

## Testing

Use `vitest` for focused coverage:

- context builder format
- config parsing and validation
- memory loading and deterministic concatenation
- skill resolution and missing-skill errors
- one CLI integration test that exercises `brainctl run` with a mocked executor

External CLIs are never invoked in tests.
