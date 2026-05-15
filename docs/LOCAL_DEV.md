# Local development — switching between local and prod

This guide covers how to point `brainctl` (CLI + MCP server + web dashboard) at a **local** instance of `brainctl-platform` (the backend + frontend) versus the **production** registry at `brainctl.net`.

## How the API target is resolved

`brainctl` resolves where to call the platform in this order. The first non-empty value wins:

1. `--api-base-url` CLI flag (per-command)
2. `BRAINCTL_API_BASE_URL` environment variable
3. `apiBaseUrl` in `~/.brainctl/config.json`
4. Default: `https://api.brainctl.net`

The platform frontend URL (used by the in-app **Sign in** button) follows the same priority:

1. `BRAINCTL_FRONTEND_URL` env var
2. `apiFrontendUrl` in `~/.brainctl/config.json`
3. Auto-derived from `apiBaseUrl`:
   - `localhost:<n>` → `localhost:5173`
   - `api.<domain>` → `app.<domain>`
4. Default: `https://app.brainctl.net`

The dashboard shows the active mode as a coloured badge next to the version in the top-left header:

- **No badge** → prod
- **Amber `LOCAL`** → `localhost` / `127.0.0.1`
- **Violet `CUSTOM`** → anything else

Hover the badge to see the exact `apiBaseUrl`.

## Local ports

| Service                                | Port |
|----------------------------------------|------|
| `brainctl-platform/backend` (axum)     | 3877 |
| `brainctl-platform/frontend` (vite)    | 5173 |
| `brainctl` web dashboard (auto-start)  | 3333 |

## Option A — env vars (recommended for testing)

Use env vars when you switch between local and prod often. No state lingers in `~/.brainctl/config.json`, so you can't accidentally publish a test profile to prod the next time you boot the dashboard.

### A1. Direct CLI

```bash
BRAINCTL_API_BASE_URL=http://localhost:3877 \
BRAINCTL_FRONTEND_URL=http://localhost:5173 \
npx tsx src/cli.ts ui
```

A shell alias is set up in `~/.zshrc`:

```bash
brainctl-local ui
```

### A2. Via the MCP server (Claude / Codex / Gemini)

When `brainctl` runs as an MCP server, the dashboard is auto-started by the MCP process — there is no separate `brainctl ui` command for you to set env vars on. You need to put the env block in the MCP registration itself.

**Claude** (`~/.claude.json`, inside `projects.<cwd>.mcpServers.brainctl`):

```json
"brainctl": {
  "type": "stdio",
  "command": "node",
  "args": [
    "/absolute/path/to/brainctl/dist/cli.js",
    "mcp"
  ],
  "env": {
    "BRAINCTL_API_BASE_URL": "http://localhost:3877",
    "BRAINCTL_FRONTEND_URL": "http://localhost:5173"
  }
}
```

**Codex** (`~/.codex/config.toml`):

```toml
[mcp_servers.brainctl]
command = "node"
args = ["/absolute/path/to/brainctl/dist/cli.js", "mcp"]
env = { BRAINCTL_API_BASE_URL = "http://localhost:3877", BRAINCTL_FRONTEND_URL = "http://localhost:5173" }
```

**Gemini** (`~/.gemini/settings.json`):

```json
"brainctl": {
  "command": "node",
  "args": ["/absolute/path/to/brainctl/dist/cli.js", "mcp"],
  "env": {
    "BRAINCTL_API_BASE_URL": "http://localhost:3877",
    "BRAINCTL_FRONTEND_URL": "http://localhost:5173"
  }
}
```

After editing, reconnect the MCP server in the agent (open a new conversation, or use the agent's `/mcp` reload). The dashboard will pick up the new env on next launch.

To switch back to prod, **remove** the `env` block (or the two keys inside it).

## Option B — persistent config (set once)

Use this when local is your default and you rarely hit prod.

```bash
brainctl config set apiBaseUrl http://localhost:3877
brainctl config set apiFrontendUrl http://localhost:5173
```

To switch back to prod:

```bash
brainctl config unset apiBaseUrl
brainctl config unset apiFrontendUrl
```

To inspect:

```bash
brainctl config status
```

Config lives in `~/.brainctl/config.json` (override path with `BRAINCTL_CONFIG_PATH`).

## Sign-in flow per environment

The dashboard's **Sign in** button opens `<frontendUrl>/cli-login?state=...&callback=http://127.0.0.1:3333/auth/finish`. After login, the browser is redirected back to the loopback callback, and `brainctl` saves the token to `apiToken` in `~/.brainctl/config.json`.

The saved `apiToken` is **tied to whichever backend issued it**. If you sign in against local and then flip back to prod, the local token will fail validation against prod and the badge in the header will revert to "not signed in".

To clear the saved token:

```bash
brainctl config unset apiToken
```

Or click the sign-out icon in the dashboard's user chip. The sign-out button is disabled when the token comes from `BRAINCTL_API_TOKEN` env — unset the env var yourself in that case.

## Full local testing workflow

```bash
# terminal 1 — backend
cd brainctl-platform/backend
cargo run                            # listens on :3877

# terminal 2 — platform frontend
cd brainctl-platform/frontend
npm run dev                          # listens on :5173

# terminal 3 — brainctl CLI (only if testing outside the MCP)
brainctl-local ui                    # dashboard on :3333
```

If using the MCP integration, you don't need terminal 3 — just reconnect the agent's MCP after putting the env block into the agent's config file.

In the dashboard:

1. Confirm the amber **LOCAL** badge sits next to the version.
2. Click **Sign in** → log in against the local platform.
3. Try **Publish to registry** on any profile. The tarball goes to `http://localhost:3877` and you can inspect it directly in the local DB / object storage.

## Common gotchas

- **Token doesn't apply after switching environments.** Run `brainctl config unset apiToken` (or sign out via the dashboard). A token from one backend won't authenticate against another.
- **`/cli-login` says "Invalid sign-in link".** The platform frontend rejects non-loopback callbacks for security. The callback must be `http://127.0.0.1:<port>/auth/finish` or `http://localhost:<port>/auth/finish`. If the dashboard is binding to a non-loopback interface, this will reject correctly — by design.
- **Dashboard shows no badge but I expected LOCAL.** The MCP server is probably still running with the old (prod) env. Reconnect it after editing the agent config.
- **`config set apiBaseUrl` fails validation.** Include the scheme (`http://` or `https://`) and omit trailing paths — only the origin is accepted.
