# Multi-Runtime MCP Packing Design

**Date:** 2026-04-09
**Goal:** Extend the portable profile pack pipeline to detect, classify, and bundle MCP servers across all common runtimes (node, python, java, go, rust, binary) so that packed archives are fully self-contained and self-describing.

**Principle:** The pack step does all the thinking. The `profile.yaml` in the archive declares `runtime`, `install`, and `exclude` explicitly. The unpacker never guesses — it reads those fields and follows instructions.

---

## Schema Changes

### New type: `McpRuntime`

```ts
type McpRuntime = 'node' | 'python' | 'java' | 'go' | 'rust' | 'binary';
```

### Updated type: `LocalBundledMcpServerConfig`

```ts
interface LocalBundledMcpServerConfig {
  kind: 'local';
  source: 'bundled';
  runtime: McpRuntime;
  path: string;
  command: string;
  args?: string[];
  install?: string;       // if undefined → nothing to run (jar/binary)
  exclude?: string[];     // if undefined → nothing to filter
  env?: Record<string, string>;
}
```

`runtime`, `install`, and `exclude` are always written into the packed `profile.yaml` when present. The unpacker treats missing `install` as "skip install step" (not "default to npm install").

---

## New Module: `src/services/runtime-detector.ts`

Three exported functions:

### `detectMcpRuntime(command: string): McpRuntime | null`

Maps command names to runtimes:

| Command(s) | Runtime |
|------------|---------|
| `node`, `nodejs` | `node` |
| `python`, `python3` | `python` |
| `uvx` | treated as npm-like package runner (see classifier) |
| `java` | `java` |
| `go` | `go` |
| `cargo` | `rust` |
| Path to local file (`./ or /`) | `binary` |
| Anything else | `null` (unrecognized) |

### `extractEntrypoint(command: string, args: string[]): string | null`

Finds the entrypoint file/path from the command + args:

| Pattern | Entrypoint |
|---------|-----------|
| `node src/index.js` | first non-flag arg |
| `python server.py` | first non-flag arg |
| `java -jar foo.jar` | arg after `-jar` |
| `go run ./cmd/server` | arg after `run` |
| `cargo run` | cwd (Cargo.toml directory) |
| `./bin/server` | the command itself |

### `findProjectRoot(entrypointPath: string, runtime: McpRuntime): { root: string; marker: string | null }`

Walks up from the entrypoint's directory looking for runtime-specific marker files:

| Runtime | Markers (priority order) |
|---------|------------------------|
| `node` | `package.json` |
| `python` | `pyproject.toml`, `requirements.txt`, `setup.py` |
| `java` | `pom.xml`, `build.gradle` |
| `go` | `go.mod` |
| `rust` | `Cargo.toml` |
| `binary` | no walk — entrypoint's directory |

Walk stops at filesystem root or after 5 levels. If no marker found, returns the entrypoint's directory as root with `marker: null`.

---

## Default Install/Exclude Table

A lookup table in `runtime-detector.ts`:

| Runtime | Condition | Default `install` | Default `exclude` |
|---------|-----------|-------------------|-------------------|
| `node` | `package.json` found | `npm install` | `["node_modules"]` |
| `python` | `uv.lock` exists | `uv sync` | `[".venv", "__pycache__", "*.pyc"]` |
| `python` | `requirements.txt` found | `pip install -r requirements.txt` | `[".venv", "__pycache__", "*.pyc"]` |
| `python` | `pyproject.toml` only | `pip install -e .` | `[".venv", "__pycache__", "*.pyc"]` |
| `java` | entrypoint is `.jar` file | *(none)* | — |
| `java` | `pom.xml` found | `mvn package -q` | `["target"]` |
| `java` | `build.gradle` found | `gradle build` | `["build"]` |
| `go` | `go.mod` found | `go build ./...` | — |
| `rust` | `Cargo.toml` found | `cargo build --release` | `["target"]` |
| `binary` | — | *(none)* | — |

---

## Integration with Existing Pack Pipeline

### `portable-mcp-classifier.ts` changes

- Replace `LOCAL_SCRIPT_RUNNERS` set with a call to `detectMcpRuntime()`
- When runtime is detected: call `extractEntrypoint()` → `findProjectRoot()` → look up defaults from table
- Write `runtime`, `install`, `exclude` into the returned `LocalBundledMcpServerConfig`
- When runtime is `null` and entry has a local-path arg: try `binary` as fallback
- When nothing matches: throw classification error (same as today)

### `portable-profile-pack-service.ts` changes

- Replace the hardcoded `node_modules` filter in the `cp()` call with a filter built from the `exclude` patterns on the classified config
- For `binary` runtime: copy just the entrypoint file, not a directory
- For `java` with `.jar` entrypoint: copy just the jar file

### `types.ts` changes

- Add `McpRuntime` type
- Add `runtime` and `exclude` fields to `LocalBundledMcpServerConfig`

### `profile-import-service.ts` changes

- Change line 118 fallback from `mcp.install ?? 'npm install'` to just `mcp.install` — skip install if undefined
- No other import-side changes needed for this feature

---

## Packed Profile Examples

```yaml
# node bundled
my-node-mcp:
  kind: local
  source: bundled
  runtime: node
  path: ./mcps/my-node-mcp
  command: node
  args: ["src/index.js"]
  install: "npm install"
  exclude: ["node_modules"]

# python bundled
my-python-mcp:
  kind: local
  source: bundled
  runtime: python
  path: ./mcps/my-python-mcp
  command: python
  args: ["server.py"]
  install: "pip install -r requirements.txt"
  exclude: [".venv", "__pycache__", "*.pyc"]

# java jar (self-contained)
my-java-mcp:
  kind: local
  source: bundled
  runtime: java
  path: ./mcps/my-java-mcp
  command: java
  args: ["-jar", "server.jar"]

# go project
my-go-mcp:
  kind: local
  source: bundled
  runtime: go
  path: ./mcps/my-go-mcp
  command: go
  args: ["run", "./cmd/server"]
  install: "go build ./..."

# rust project
my-rust-mcp:
  kind: local
  source: bundled
  runtime: rust
  path: ./mcps/my-rust-mcp
  command: cargo
  args: ["run"]
  install: "cargo build --release"
  exclude: ["target"]

# precompiled binary
my-binary-mcp:
  kind: local
  source: bundled
  runtime: binary
  path: ./mcps/my-binary-mcp
  command: "./server"
```

---

## Scope

**In scope:**
- Runtime detection from command name
- Entrypoint extraction from args
- Project root discovery via marker files
- Default install/exclude lookup
- Writing runtime/install/exclude into profile.yaml at pack time
- Filtering bundled copies using exclude patterns
- Removing hardcoded `npm install` fallback on import

**Out of scope:**
- Profile-declared `install`/`exclude` override (profile schema already supports it — pack from profile just passes through)
- `uvx` is treated as an npm-like package runner in the classifier (same as `npx` — reference by package name, nothing to bundle). This is handled alongside the existing `resolveNpxPackage` logic, not in the runtime detector.
- Docker-based MCPs
- Remote MCP changes
