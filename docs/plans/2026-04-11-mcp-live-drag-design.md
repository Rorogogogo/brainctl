# MCP Live Drag Design

## Goal

Make UI-driven MCP drag/copy between Claude, Codex, and Gemini reliable for:
- remote MCPs represented as transport metadata
- local MCPs represented as command-based stdio launchers

The system must preserve exact launcher semantics for supported local MCPs and reject unsupported or lossy conversions before writing broken agent config.

## Constraints

- Live agent configs remain the source of truth.
- No new persisted intermediate MCP layer.
- Support only the current agents: Claude, Codex, Gemini.
- Fail closed for unsupported local launchers.

## Current Problems

- Remote MCPs are typed in the backend but not populated by live readers.
- The Profiles UI only renders and stages local `command`/`args` MCP entries.
- Local launcher semantics are partially collapsed, especially package runners such as `uvx`.
- Gemini live config paths are inconsistent between sync and direct UI mutation code.

## Design

### MCP Shapes

Use two explicit live MCP shapes throughout the UI and backend:

1. Local MCP
   - `command`
   - `args?`
   - `env?`

2. Remote MCP
   - `transport`
   - `url`
   - `headers?`
   - `env?`

The drag flow remains live-to-live, but the system must preserve shape and reject cross-shape guesses.

### Supported Local Launchers

Allow direct copy only for launchers the code can preserve exactly:
- `npx`
- `uvx`
- `node`
- `python`
- `python3`
- `java -jar`
- `go run`
- `cargo run`
- direct local binaries and scripts

Everything else must fail preflight with an explicit unsupported-launcher message.

### Reader/Writer Behavior

- Claude reader: read both local stdio MCPs and remote MCPs if present in the config.
- Codex reader: read local MCPs from TOML and remote MCPs if the config format exposes them.
- Gemini reader: read both local and remote MCPs from the same config path used by live mutation.
- UI mutation endpoints: accept local and remote MCP payloads separately, validate them, and write exact target-agent format.

### UI Behavior

- Show remote MCPs in the MCP section alongside local entries, with distinct subtitles.
- Dragging a remote MCP should stage a remote MCP addition.
- Dragging a local MCP should stage a local MCP addition only if the launcher is supported exactly.
- Applying staged changes should route local and remote MCPs through separate backend validation paths.

### Validation

- Remote MCP validation:
  - transport must be `http` or `sse`
  - URL must be absolute `http(s)`
- Local MCP validation:
  - launcher must be in the supported set
  - launcher-specific required arguments must be present
  - local entrypoints must exist when the launcher implies a local file

### Testing

Add focused tests for:
- live reader extraction of remote MCPs
- remote MCP staging/apply helpers
- local MCP copy for supported launchers
- rejection of unsupported or lossy launchers
- Gemini path consistency

## Non-Goals

- Universal support for arbitrary shell wrappers, Docker, or other opaque launchers
- Implicit best-effort conversion of unsupported MCPs
- Adding a new persisted profile-like canonical layer
