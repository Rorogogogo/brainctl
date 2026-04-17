# brainctl reference

A quick reference for every user-facing surface: CLI commands, MCP tools, and the web dashboard.

## CLI commands

Invoked as `brainctl <command>` (or during dev `npm run dev -- <command>`).

| Command | Purpose |
|---|---|
| `init` | Scaffold `ai-stack.yaml` and `.brainctl/` metadata for a new project. |
| `run <skill> <input>` | Execute a configured skill through the resolved agent CLI; prints stdout and exit code. |
| `status` | Print the active profile, configured agents, and which CLIs are reachable. |
| `doctor` | Run environment checks (agent availability, config integrity, credential presence). |
| `sync` | Reconcile `ai-stack.yaml` MCP declarations with each agent's live config. |
| `profile <subcommand>` | Manage portable profiles — `list`, `switch`, `create`, `delete`, `export`, `import`. |
| `mcp` | Start the brainctl MCP server (stdio) so other agents can call brainctl tools. |
| `ui` | Launch the local web dashboard at `http://127.0.0.1:3333`. |

## MCP tools

Exposed by `brainctl mcp`. All tools are prefixed `brainctl_` and accept Zod-validated input.

### Agent config

| Tool | Description |
|---|---|
| `brainctl_read_agent_configs` | Return live MCP + skill state for Claude, Codex, and Gemini. |
| `brainctl_add_agent_mcp` | Add an MCP server entry to a specific agent's config. |
| `brainctl_remove_agent_mcp` | Remove an MCP server entry from a specific agent's config. |

### Skills

| Tool | Description |
|---|---|
| `brainctl_list_skills` | List skills declared in `ai-stack.yaml`. |
| `brainctl_get_skill` | Return the resolved prompt text for a given skill. |
| `brainctl_run` | Run a skill through an agent CLI and return its output. |

### Memory

| Tool | Description |
|---|---|
| `brainctl_read_memory` | Read the combined memory markdown for the active profile. |
| `brainctl_write_memory` | Append or overwrite a memory entry. |

### Profiles

| Tool | Description |
|---|---|
| `brainctl_list_profiles` | List profiles under `.brainctl/profiles/`. |
| `brainctl_get_profile` | Return a profile's YAML. |
| `brainctl_create_profile` | Create a new profile. |
| `brainctl_update_profile` | Mutate an existing profile. |
| `brainctl_delete_profile` | Remove a profile. |
| `brainctl_switch_profile` | Mark a profile as active. |
| `brainctl_copy_profile_items` | Copy MCPs/skills/plugins from one agent to another. |
| `brainctl_export_profile` | Pack a profile to a `.tar.gz` with redacted credentials. |
| `brainctl_import_profile` | Unpack a profile archive, resolving credentials. |

### Status & lifecycle

| Tool | Description |
|---|---|
| `brainctl_status` | Machine-readable version of `brainctl status`. |
| `brainctl_doctor` | Machine-readable environment diagnostics. |
| `brainctl_sync` | Programmatic reconcile of `ai-stack.yaml` ↔ agent configs. |
| `brainctl_open_ui` | Start the dashboard and return its URL. |
| `brainctl_close_ui` | Stop the dashboard server. |

## Web dashboard

Launch with `brainctl ui`. Served at `http://127.0.0.1:3333`.

| View | What it does |
|---|---|
| Profiles | Three-column drag-and-drop of live MCPs, skills, and plugins across Claude / Codex / Gemini. Staged changes preview before save. |
| Skills | Browse skills declared in `ai-stack.yaml` with resolved prompt text. |
| MCPs | Inspect the unified MCP list across agents. |
| Run | Execute a skill and stream output over SSE. |

## Cross-agent plugin transfer

When you drag a plugin between agents in Profiles:

- **Claude ↔ Codex** — full transfer. Skills copy as-is; `.mcp.json` entries merge into the target config; subagents convert between `.md` (Claude) and `.toml` (Codex); slash commands become Codex skills (`$name`-invocable) or convert back to `~/.claude/commands/`.
- **Target = Gemini** — skills + MCPs only; agents and commands show as warnings and are skipped.
- Plugin identity is tracked in `~/.brainctl/managed-plugins.json`; removing the plugin card cascades removal of every installed skill, MCP, agent, and command.

## Config files

| Path | Role |
|---|---|
| `ai-stack.yaml` | Per-project config — skills, memory paths, MCPs. |
| `.brainctl/meta.yaml` | Active profile + tracked agents. |
| `.brainctl/profiles/*.yaml` | Profile definitions. |
| `~/.brainctl/managed-plugins.json` | Cross-agent plugin install registry. |
