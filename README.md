> [!IMPORTANT]
> **brainctl is now part of [NoMoreIDE](https://github.com/Rorogogogo/nomoreide)** and no longer receives updates. Everything brainctl did — agent config management, profiles, and the hosted registry — lives on as NoMoreIDE's **Agent Environments** feature: `npm i -g nomoreide`.
>
> 📖 **[Migration guide](https://github.com/Rorogogogo/nomoreide/blob/main/docs/brainctl-migration.md)** — command mapping, MCP tool mapping (`brainctl_*` → `nomoreide_*`), and what changed.
>
> The hosted registry (app.brainctl.net) **keeps running**: your account, published profiles, and installs all keep working through NoMoreIDE, which reads your existing `~/.brainctl/config.json` sign-in.

<div align="center">

# 🧠 brainctl

**One AI setup. Three agents. Zero reconfiguration.**

*A cross-agent command centre for Claude Code, Codex, and Antigravity CLI — CLI + MCP server + drag-and-drop web dashboard.*

[![npm version](https://img.shields.io/npm/v/brainctl)](https://www.npmjs.com/package/brainctl)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE) [![Commercial License](https://img.shields.io/badge/license-Commercial-orange.svg)](COMMERCIAL.md)
[![Build](https://img.shields.io/github/actions/workflow/status/Rorogogogo/brainctl/deploy.yml?branch=main)](https://github.com/Rorogogogo/brainctl/actions)
[![Stars](https://img.shields.io/github/stars/Rorogogogo/brainctl?style=social)](https://github.com/Rorogogogo/brainctl)

</div>

---

## 📦 Install & Set Up

> **Zero install required.** Brainctl runs straight from npx — register it as an MCP server in your agent and you're done. No global install, no bin to manage.

> **Prerequisite:** at least one of `claude`, `codex`, or `antigravity` installed and on your `PATH`.

### 1. Register `brainctl` as an MCP server (pick your agents)

Each agent has its own config file. Brainctl exposes **22 MCP tools** (profiles, sync, skills, run, web UI launch, etc.) — once you register it, any of them can call those tools.

<details open>
<summary><b>🟣 Claude Code</b> — <code>~/.claude.json</code></summary>

Easiest: use the `claude` CLI.

```bash
claude mcp add brainctl -s user -- npx -y brainctl mcp
```

Or edit `~/.claude.json` directly:

```jsonc
{
  "mcpServers": {
    "brainctl": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "brainctl", "mcp"]
    }
  }
}
```

Reload the MCP in Claude Code: `/mcp` → `brainctl` → **Reconnect**.

</details>

<details open>
<summary><b>🟢 Codex</b> — <code>~/.codex/config.toml</code></summary>

Easiest: use the `codex` CLI.

```bash
codex mcp add brainctl -- npx -y brainctl mcp
```

Or edit `~/.codex/config.toml` directly:

```toml
[mcp_servers.brainctl]
command = "npx"
args = ["-y", "brainctl", "mcp"]
```

Restart your Codex session to pick it up.

</details>

<details open>
<summary><b>🔵 Antigravity CLI</b> — <code>~/.gemini/antigravity-cli/mcp_config.json</code></summary>

Easiest: use the `antigravity` CLI.

```bash
antigravity mcp add -s user brainctl npx -y brainctl mcp
```

Or edit `~/.gemini/antigravity-cli/mcp_config.json` directly:

```json
{
  "mcpServers": {
    "brainctl": {
      "command": "npx",
      "args": ["-y", "brainctl", "mcp"]
    }
  }
}
```

Restart your Antigravity session.

</details>

---

### 2. Open the dashboard

From any MCP-connected agent, just ask:

> _"Open the brainctl UI"_

It'll start the server **and** open your browser automatically at http://127.0.0.1:3333.

---

### Optional: install the CLI globally

Prefer a shell command? Install globally:

```bash
npm install -g brainctl
brainctl --version
brainctl doctor     # checks which agents are on your PATH
brainctl ui         # launch the dashboard from your terminal
```

The CLI is entirely optional — everything it does is also available through the MCP tools and the dashboard.

### Local platform development

Registry commands and MCP registry tools use the hosted API by default:

```text
https://api.brainctl.net
```

When testing against a local `brainctl-platform` backend, set the shared API target once:

```bash
brainctl config set apiBaseUrl http://127.0.0.1:3877
brainctl config status
```

That value is saved in `~/.brainctl/config.json` and is used by both CLI commands and MCP sessions. Clear it to return to production:

```bash
brainctl config unset apiBaseUrl
```

---

## ✨ Features

- 🔀 **Multi-agent** — Claude Code, Codex, Antigravity CLI from one config
- 🖱️ **Drag-and-drop dashboard** — shuffle MCPs and skills between agents, staged + previewed before save
- 🔌 **MCP server** — 22 tools any compatible agent can call
- 📦 **Portable profiles** _(preview)_ — pack an entire agent setup (plugins + skills + MCPs) into a self-contained tarball
- 🌐 **Multi-runtime packing** — Node, Python, Java, Go, Rust, or plain binaries — auto-detected
- 🧠 **Shared memory** — markdown files injected into every run
- 🧩 **Reusable skills** — prompt templates in `ai-stack.yaml`
- 🔄 **One-shot sync** — push the active profile to all agents in one command
- 🩺 **Health checks** — `status` and `doctor` surface drift and broken config
- 🔁 **Fallback agents** — automatic failover if the primary agent is unavailable

---

## 📸 Dashboard at a glance

```
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│    Claude    │  │    Codex     │  │ Antigravity  │
│ ┌──────────┐ │  │ ┌──────────┐ │  │              │
│ │ github   │◄├──┤►│ github   │ │  │  drop here   │
│ │ brainctl │ │  │ │ brainctl │ │  │  to copy     │
│ └──────────┘ │  │ └──────────┘ │  │              │
│ Skills: 11   │  │ Skills: 3    │  │ Skills: 0    │
└──────────────┘  └──────────────┘  └──────────────┘
```

The dashboard reads **live config files** (`~/.claude.json`, `~/.codex/config.toml`, `~/.gemini/antigravity-cli/mcp_config.json`) and writes back atomically with timestamped backups.

---

## 🚀 Quick Start

```bash
# Scaffold a project
brainctl init

# See what's wired up
brainctl status
brainctl doctor

# Run a skill through an agent
brainctl run summarize ./memory/notes.md --with claude

# Open the dashboard
brainctl ui
```

---

## 📖 CLI reference

| Command | What it does |
|---|---|
| `brainctl init` | Scaffold `ai-stack.yaml` and `memory/` |
| `brainctl config get / set / unset apiBaseUrl` | Configure the shared platform API URL for CLI and MCP |
| `brainctl status` | Memory, skills, MCPs, and agent availability |
| `brainctl doctor` | Validate config, paths, and agent CLIs |
| `brainctl run <skill> <file> --with <agent>` | Execute a skill |
| `brainctl profile list / create / use / delete` | Manage saved profiles |
| `brainctl profile export [name] [--agent <agent>]` | Pack a profile or live agent as a portable tarball |
| `brainctl profile import <archive> [--credential key=value]` | Restore a portable tarball |
| `brainctl sync` | Push the active profile to every agent |
| `brainctl ui` | Start the web dashboard |
| `brainctl mcp` | Run as an MCP server over stdio |

### Run examples

```bash
brainctl run summarize ./notes.md --with claude
brainctl run analyze   ./report.md --with codex --fallback claude
brainctl run review    ./code.md   --with antigravity
```

---

## 📦 Portable profiles

Pack your complete agent setup — **plugins, user-authored skills, and MCPs** — into a single `.tar.gz`. The receiver imports it with one command; no marketplace, no network lookups.

```bash
# Pack a saved profile
brainctl profile export starter

# Pack a live agent's state (plugins + skills + MCPs)
brainctl profile export --agent claude

# Restore on another machine
brainctl profile import ./claude.tar.gz \
  --credential github_token=ghp_xxx
```

**Supported MCP runtimes when packing bundled servers:**

| Runtime | Detected via | Install on unpack | Excluded |
|---|---|---|---|
| Node.js | `node`, `npx` | `npm install` | `node_modules/` |
| Python | `python`, `python3` | `pip install` / `uv sync` | `.venv/`, `__pycache__/` |
| Java | `java -jar` | — | — |
| Java (project) | `pom.xml`, `build.gradle` | `mvn package` / `gradle build` | `target/`, `build/` |
| Go | `go run` | `go build ./...` | — |
| Rust | `cargo run` | `cargo build --release` | `target/` |
| Binary | `./server` | — | — |

Credentials are redacted to `${credentials.<key>}` placeholders on export and resolved on import.

> ⚠️ Pack / Install via the web UI is currently disabled while we grind the last rough edges. The CLI commands above work today.

---

## 🧠 `ai-stack.yaml`

```yaml
memory:
  paths:
    - ./memory

skills:
  summarize:
    description: Summarize content into bullet points
    prompt: |
      Summarize the following content into concise bullet points.

  review:
    description: Code review with actionable feedback
    prompt: |
      Review the following code and provide actionable feedback.

mcps: {}
```

### How context is assembled

```
┌─────────────┐
│   MEMORY    │  ← markdown files from configured paths
├─────────────┤
│   SKILL     │  ← prompt template from ai-stack.yaml
├─────────────┤
│   INPUT     │  ← your file
└─────────────┘
        ↓
   Agent CLI (claude / codex / antigravity)
```

---

## 🔌 MCP tools

| Category | Tools |
|---|---|
| **Skills** | `list_skills`, `get_skill`, `run` |
| **Memory** | `read_memory`, `write_memory` |
| **Profiles** | `list_profiles`, `get_profile`, `create_profile`, `update_profile`, `delete_profile`, `switch_profile`, `copy_profile_items`, `export_profile`, `import_profile` |
| **Agent configs** | `read_agent_configs`, `add_agent_mcp`, `remove_agent_mcp` |
| **Sync** | `sync` |
| **System** | `status`, `doctor` |
| **UI** | `open_ui`, `close_ui` |

---

## 🗂️ Agent config map

| Agent | Config file | MCP location | Skills / plugins |
|---|---|---|---|
| Claude | `~/.claude.json` | `mcpServers` + `projects[cwd].mcpServers` | `~/.claude/plugins/` + `~/.claude/skills/` |
| Codex | `~/.codex/config.toml` | `[mcp_servers.*]` | `~/.codex/plugins/` + `~/.codex/skills/` |
| Antigravity | `~/.gemini/antigravity-cli/mcp_config.json` | `mcpServers` | `~/.gemini/skills/` |

Writes are atomic (temp file → rename) and always leave a timestamped `.bak.*` behind.

---

## 🏗️ Architecture

```
brainctl/
├── src/
│   ├── cli.ts              # Commander entry
│   ├── commands/           # CLI handlers
│   ├── services/           # Business logic (factory pattern)
│   │   └── sync/           # Per-agent readers + writers
│   ├── context/            # Memory + skill + context builder
│   ├── executor/           # Agent subprocess spawning
│   ├── mcp/                # FastMCP server
│   └── ui/                 # HTTP server (SSE streaming)
├── web/src/                # React dashboard (Vite + dnd-kit)
└── tests/                  # Vitest suite
```

---

## 🧪 Develop locally

```bash
git clone https://github.com/Rorogogogo/brainctl.git
cd brainctl
npm install

npm test                  # vitest
npm run build             # server (tsc) + web (vite)
npm run dev -- status     # run CLI via tsx
npx tsx src/cli.ts ui     # dashboard from source
```

Point your agent's MCP config at `node <repo>/dist/cli.js mcp` to iterate without publishing.

---

## 💡 Philosophy

brainctl doesn't replace your AI tools — it sits **between you and them** as a thin orchestration layer:

- You keep using Claude Code, Codex, and Antigravity CLI directly.
- brainctl keeps the environment consistent across all of them.
- Portable profiles make your setup shareable in one file.

---

## 🤝 Contributing

Issues and PRs welcome. See [`CLAUDE.md`](CLAUDE.md) for the codebase map an agent-friendly contribution flow.

---

## 📄 License

Dual-licensed: **AGPL-3.0** (free for open-source / personal use, see [LICENSE](LICENSE)) and **Commercial** (closed-source / proprietary / hosted SaaS, see [COMMERCIAL.md](COMMERCIAL.md)).

## License

This project is **dual-licensed**:

- 🆓 **AGPL-3.0** — free for personal use, open-source forks, and projects themselves open-sourced under a compatible license. See [LICENSE](LICENSE).
- 💼 **Commercial license** — required for closed-source products, proprietary internal tools, or paid / hosted services where AGPL-3.0's copyleft and network-use obligations don't fit. See [COMMERCIAL.md](COMMERCIAL.md).

### Do I need a commercial license?

| Use case | License |
|---|---|
| Personal use / running locally | AGPL-3.0 (free) |
| Forking and publishing under AGPL-3.0 | AGPL-3.0 (free) |
| Bundling into a closed-source product | **Commercial** |
| Hosting a modified version as a SaaS without publishing source | **Commercial** |
| Internal company tool not open-sourced | **Commercial** |

For a commercial license, contact **Robert Wang** at **xwang.robert@gmail.com** — see [COMMERCIAL.md](COMMERCIAL.md) for what to include in your request.
