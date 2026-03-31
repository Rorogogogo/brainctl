# 🧠 brainctl

> One AI setup. Multiple agents. Zero reconfiguration.

**brainctl** is a cross-agent AI workflow manager that unifies your environment across Claude Code, Codex, and Gemini CLI — with a web dashboard, MCP server, and portable profiles.

[![npm version](https://img.shields.io/npm/v/brainctl)](https://www.npmjs.com/package/brainctl)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Build](https://img.shields.io/github/actions/workflow/status/Rorogogogo/brainctl/deploy.yml?branch=main)](https://github.com/Rorogogogo/brainctl/actions)

---

## ✨ Features

- 🔀 **Multi-agent support** — Claude Code, Codex, and Gemini CLI from one config
- 🖥️ **Web dashboard** — Visual drag-and-drop MCP management across agents
- 🔌 **MCP server** — 20 tools exposable to any MCP-compatible agent
- 📦 **Portable profiles** — Export/import skill + MCP bundles as tarballs
- 🧠 **Shared memory** — Markdown-based context files shared across agents
- 🧩 **Reusable skills** — Prompt templates stored in `ai-stack.yaml`
- 🔄 **Profile sync** — Push configs to all agents in one command
- 🩺 **Health checks** — `status` and `doctor` commands for visibility
- 🔁 **Fallback agents** — Automatic failover if primary agent is unavailable

---

## 📸 Demo

### Web Dashboard — Drag MCPs between agents

```
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│    Claude     │  │    Codex     │  │    Gemini    │
│ ┌──────────┐ │  │ ┌──────────┐ │  │              │
│ │ github   │◄├──┤►│ github   │ │  │  Drop here   │
│ │ brainctl │ │  │ │ brainctl │ │  │  to copy     │
│ └──────────┘ │  │ └──────────┘ │  │              │
│ Skills: 11   │  │ Skills: 3    │  │ Skills: 0    │
└──────────────┘  └──────────────┘  └──────────────┘
```

The dashboard reads **live config files** from each agent (`~/.claude.json`, `~/.codex/config.toml`, `~/.gemini/settings.json`) and lets you drag MCPs between them. Changes are staged and only applied on confirm.

---

## 📦 Installation

```bash
npm install -g brainctl
```

Or from source:

```bash
git clone https://github.com/Rorogogogo/brainctl.git
cd brainctl
npm install && npm run build && npm link
```

> **Prerequisite:** At least one supported agent CLI must be installed and on your `PATH` (`claude`, `codex`, or `gemini`).

---

## 🚀 Quick Start

```bash
# 1. Initialize a project
brainctl init

# 2. Check your setup
brainctl status
brainctl doctor

# 3. Run a skill
brainctl run summarize ./memory/notes.md --with claude

# 4. Launch the web dashboard
brainctl ui
# → http://127.0.0.1:3333
```

---

## 📖 Usage

### CLI Commands

| Command | Description |
|---------|-------------|
| `brainctl init` | Scaffold `ai-stack.yaml` and `memory/` directory |
| `brainctl status` | Show memory, skills, MCPs, and agent availability |
| `brainctl doctor` | Validate config, paths, and installed agents |
| `brainctl run <skill> <file> --with <agent>` | Execute a skill through an agent |
| `brainctl profile list` | List available profiles |
| `brainctl profile create <name>` | Create a new profile |
| `brainctl profile use <name>` | Switch active profile |
| `brainctl profile export <name>` | Export profile as portable tarball |
| `brainctl profile import <archive>` | Import profile from tarball |
| `brainctl sync` | Sync active profile to all agent configs |
| `brainctl ui` | Start the web dashboard |

### Run Examples

```bash
# Basic execution
brainctl run summarize ./notes.md --with claude

# With fallback agent
brainctl run analyze ./report.md --with codex --fallback claude

# Using Gemini
brainctl run review ./code.md --with gemini
```

---

## 🧠 Config: `ai-stack.yaml`

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

### How Context Assembly Works

```
┌─────────────┐
│   MEMORY    │  ← Markdown files from configured paths
├─────────────┤
│   SKILL     │  ← Prompt template from ai-stack.yaml
├─────────────┤
│   INPUT     │  ← Your file
└─────────────┘
        ↓
   Agent CLI (claude / codex / gemini)
```

---

## 🔌 MCP Server

brainctl exposes **20 MCP tools** that any compatible agent can call:

```bash
# Add brainctl as an MCP server in your agent config
# Claude (~/.claude.json):
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

**Available tools:**

| Category | Tools |
|----------|-------|
| **Skills** | `list_skills`, `get_skill`, `run` |
| **Memory** | `read_memory`, `write_memory` |
| **Profiles** | `list_profiles`, `get_profile`, `create_profile`, `update_profile`, `delete_profile`, `switch_profile`, `copy_profile_items`, `export_profile`, `import_profile` |
| **Agent Configs** | `read_agent_configs`, `add_agent_mcp`, `remove_agent_mcp` |
| **System** | `status`, `doctor`, `sync` |

---

## 🖥️ Web Dashboard

```bash
brainctl ui
```

Opens a local dashboard at `http://127.0.0.1:3333` with:

- **Agent Profiles** — See live MCPs and skills for Claude, Codex, and Gemini side-by-side
- **Drag & Drop** — Copy MCPs between agents by dragging cards
- **Staged Changes** — Preview adds/removes before applying, with undo support
- **Skills Editor** — Edit skill prompts with live preview
- **MCP Manager** — View and edit MCP configurations
- **Memory Viewer** — Browse shared markdown memory files
- **Run Console** — Execute skills with real-time streaming output

---

## 🏗️ Architecture

```
brainctl/
├── src/
│   ├── cli.ts              # CLI entry point (Commander)
│   ├── commands/            # 8 command handlers
│   ├── services/            # 11 business logic services
│   │   └── sync/            # Agent config readers/writers
│   ├── context/             # Memory loader, skill resolver, context builder
│   ├── executor/            # Agent spawning (Claude, Codex, Gemini)
│   ├── mcp/                 # FastMCP server (20 tools)
│   └── ui/                  # HTTP server with SSE streaming
├── web/src/                 # React dashboard (Vite + dnd-kit)
├── tests/                   # Vitest test suite
└── ai-stack.yaml            # Project config
```

### Agent Config Locations

| Agent | Config Path | MCP Location |
|-------|-------------|-------------|
| Claude | `~/.claude.json` | `projects[cwd].mcpServers` |
| Codex | `~/.codex/config.toml` | `[mcp_servers.*]` |
| Gemini | `~/.gemini/settings.json` | `mcpServers` |

---

## 🧪 Development

```bash
npm install
npm test              # Run all tests (Vitest)
npm run build         # Build server (tsc) + web (Vite)
npm run dev -- <args> # Run CLI via tsx
```

---

## 🤝 Contributing

Contributions are welcome! Please open an issue or submit a pull request.

```bash
git clone https://github.com/Rorogogogo/brainctl.git
cd brainctl
npm install
npm test
```

---

## 💡 Philosophy

brainctl doesn't replace your AI tools. It sits between you and them as a thin orchestration layer:

- **You keep using** Claude Code, Codex, and Gemini CLI directly
- **brainctl keeps** the environment consistent across all of them
- **Profiles make it portable** — share your setup with your team

---

## 📄 License

[MIT](https://opensource.org/licenses/MIT) — use it however you want.
