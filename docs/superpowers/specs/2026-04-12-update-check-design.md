# Update Check & Auto-Update Design

## Problem

When brainctl MCP is copied between agents (e.g., Claude → Codex), the target agent launches `npx brainctl mcp`, which resolves to whatever global binary is installed. If that binary is stale, the MCP server fails silently — the command either doesn't exist or the entrypoint is broken. Users have no way to know why, and no automated fix.

## Solution

Add an update-check service that:
- **MCP mode**: auto-updates silently before starting the server, then re-execs
- **CLI mode**: prompts the user to update interactively

A 24-hour cache prevents hitting the npm registry on every invocation.

## Architecture

### New file: `src/services/update-check-service.ts`

Factory: `createUpdateCheckService(deps?)` returning:

```ts
interface UpdateCheckService {
  check(): Promise<UpdateCheckResult>;
  selfUpdate(): Promise<SelfUpdateResult>;
}

interface UpdateCheckResult {
  current: string;
  latest: string;
  isOutdated: boolean;
  fromCache: boolean;
}

interface SelfUpdateResult {
  success: boolean;
  fromVersion: string;
  toVersion: string;
  error?: string;
}
```

### Cache file: `~/.brainctl/update-check.json`

```json
{
  "lastCheck": "2026-04-12T10:00:00Z",
  "latestVersion": "0.2.0"
}
```

### Check logic

1. Read cache file from `~/.brainctl/update-check.json`
2. If `lastCheck` is within 24 hours → use cached `latestVersion`, set `fromCache: true`
3. Otherwise → GET `https://registry.npmjs.org/brainctl/latest` with 3-second timeout
4. Write updated cache
5. Compare `latestVersion` against current `package.json` version (simple semver string comparison)
6. Return `{ current, latest, isOutdated, fromCache }`

### Self-update logic

1. Spawn `npm install -g brainctl@latest` using `execFile` (not `exec`, to avoid shell injection — follow existing `execFileNoThrow` pattern in `src/utils/execFileNoThrow.ts`)
2. Wait for completion (with 60-second timeout)
3. If success → return `{ success: true, fromVersion, toVersion }`
4. If failure → return `{ success: false, error }`, do not throw

### Re-exec logic

After a successful self-update, re-exec the current `process.argv` using `execFile` so the new binary takes over. This replaces the running process with the updated version.

## Integration Points

### CLI mode (`src/cli.ts` → `main()`)

After `program.parseAsync()` completes:

1. Run `check()` (non-blocking, don't delay the command output)
2. If outdated, prompt to stderr:
   ```
   ⚠ brainctl <latest> is available (you have <current>).
     Update now? [Y/n]
   ```
3. If user answers Y → run `selfUpdate()`, print result
4. If user answers n → skip

Skip the check entirely when:
- `BRAINCTL_NO_UPDATE_CHECK=1` is set (for CI/scripting)
- stdin is not a TTY (non-interactive, can't prompt)
- Running from local dev (`npx tsx` / not in `node_modules`)

### MCP mode (`src/commands/mcp.ts`)

Before calling `startMcpServer()`:

1. Run `check()`
2. If outdated → run `selfUpdate()`
3. If update succeeded → re-exec `process.argv` using `execFile` (new binary starts MCP server)
4. If update failed → log warning to stderr, continue with current version

This happens before any stdio MCP communication, so it won't interfere with JSON-RPC.

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| No network / timeout | 3s timeout on registry fetch, silently continue |
| Cache file missing or corrupt | Treat as expired, do fresh check |
| Update fails (permissions, network) | Log to stderr, continue with current version |
| Already on latest | Update cache timestamp, move on |
| Local dev mode (`npx tsx src/cli.ts`) | Skip update check entirely |
| Non-interactive terminal (piped input) | CLI: skip prompt, just warn. MCP: auto-update as normal |
| Pre-feature binary (≤ 0.1.7) | Cannot self-heal — requires one manual `npm install -g brainctl` |

## Opt-out

- Environment variable: `BRAINCTL_NO_UPDATE_CHECK=1` disables all update checks
- Useful for CI pipelines, testing, and scripting

## Files to create/modify

| File | Action |
|------|--------|
| `src/services/update-check-service.ts` | Create — update check + self-update logic |
| `src/cli.ts` | Modify — add post-parse update check with interactive prompt |
| `src/commands/mcp.ts` | Modify — add pre-start auto-update with re-exec |

## Dependencies

No new npm dependencies. Uses:
- `node:https` — npm registry fetch
- `node:fs/promises` — cache file read/write
- `node:child_process` (`execFile`) — npm install and re-exec (following `execFileNoThrow` pattern, no shell injection risk)
- `node:readline` — Y/n prompt in CLI mode
