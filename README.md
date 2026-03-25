# 🧠 brainctl

> Stop reconfiguring your AI tools.

`brainctl` is a CLI for managing a portable AI environment across tools like Claude Code and Codex.

Define your memory, skills, and execution flow once, then reuse them across different AI agents.

---

## ✨ Why brainctl?

If you're using multiple AI tools, you've probably already hit the same problems:

- Rewriting the same prompt for different agents
- Losing context between tools
- Rebuilding your environment every time you switch

`brainctl` solves that with one core idea:

> **One AI setup. Multiple agents.**

---

## 🚀 Features

- 🧠 File-based memory from Markdown files
- 🧩 Reusable skills stored in `ai-stack.yaml`
- 🔌 Multi-agent execution with Claude and Codex
- ⚙️ Unified context builder
- 🛠 CLI-first workflow
- 🔍 `status` and `doctor` for visibility
- 🔁 Optional fallback agent support with `--fallback`

---

## 📦 Installation

### Option 1: Install from npm

```bash
npm install -g brainctl
```

Then:

```bash
brainctl --help
```

### Option 2: Local CLI install from source

```bash
npm install
npm run build
npm link
```

Then:

```bash
brainctl --help
```

### Option 3: Run without linking

```bash
npm install
npm run build
node dist/cli.js --help
```

`brainctl` does not bundle agent CLIs. You still need at least one supported agent installed separately and available on `PATH`, such as `claude` or `codex`.

---

## ⚡ Quick Start

### 1. Initialize a project

```bash
brainctl init
```

This creates:

- `ai-stack.yaml`
- `memory/`
- `memory/notes.md`

### 2. Inspect the setup

```bash
brainctl status
brainctl doctor
```

### 3. Run a task

```bash
brainctl run summarize ./memory/notes.md --with claude
```

Or:

```bash
brainctl run summarize ./memory/notes.md --with codex
```

With fallback:

```bash
brainctl run summarize ./memory/notes.md --with claude --fallback codex
```

---

## 🧠 Example `ai-stack.yaml`

```yaml
memory:
  paths:
    - ./memory

skills:
  summarize:
    description: Summarize content
    prompt: |
      Summarize the following content into concise bullet points.

  analyze:
    description: Analyze content deeply
    prompt: |
      Analyze the following content and extract key insights.

mcps: {}
```

---

## 🧩 How It Works

`brainctl` builds a unified context before calling an agent:

```text
--- MEMORY ---
[your markdown files]

--- SKILL ---
[prompt template]

--- INPUT ---
[your file]
```

That context is then sent to the selected agent over stdin.

---

## 🛠 Usage

### Commands

| Command | Purpose |
| --- | --- |
| `brainctl init` | Initialize `ai-stack.yaml` and memory files |
| `brainctl status` | Show memory, skills, MCP count, and agent availability |
| `brainctl doctor` | Validate config, memory paths, skills, and installed agents |
| `brainctl run <skill> <file> --with <agent>` | Build context and execute with an agent |

### Examples

```bash
brainctl run summarize ./memory/notes.md --with claude
brainctl run analyze ./memory/notes.md --with codex
brainctl run summarize ./memory/notes.md --with claude --fallback codex
```

---

## 📂 Project Structure

```text
brainctl/
├── src/
│   ├── cli.ts
│   ├── config.ts
│   ├── context/
│   ├── commands/
│   ├── executor/
│   └── services/
├── tests/
├── ai-stack.yaml
├── memory/
├── package.json
└── tsconfig.json
```

---

## 🧪 Development

```bash
npm install
npm test
npm run build
```

---

## 🧠 Philosophy

`brainctl` does not replace your AI tools.

It sits between you and them as a thin orchestration layer:

- You keep using Claude, Codex, and other agent CLIs
- `brainctl` keeps the environment consistent

---

## 🗺 Roadmap

- [ ] JSON output mode
- [ ] Multi-agent pipelines
- [ ] MCP runtime integration
- [ ] Better execution tracing and logs
- [ ] UI / dashboard

---

## 💡 Inspiration

AI tools are getting more powerful, but also more fragmented.

`brainctl` is an attempt to bring state, structure, and consistency to that workflow.

---

## 📄 License

MIT
