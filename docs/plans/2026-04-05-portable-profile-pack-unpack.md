# Portable Profile Pack/Unpack Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a robust portable profile format and pack/unpack flow that can normalize live Claude/Codex/Gemini MCP configs, redact credentials into placeholders, and install archives deterministically for another user.

**Architecture:** Add a canonical portable-profile schema plus a manifest that carries schema version, source metadata, and credential requirements. Implement a pack pipeline that classifies MCPs once, writes explicit normalized metadata, and an unpack pipeline that validates the archive, resolves credentials, installs bundled assets, clears stale files on overwrite, and runs preflight checks without re-guessing MCP types.

**Tech Stack:** TypeScript, Node.js, Commander, Vitest, YAML, existing Brainctl UI/API services

---

### Task 1: Lock the portable archive contract in tests first

**Files:**
- Create: `tests/portable-profile-schema.test.ts`
- Create: `tests/fixtures/portable-profile/minimal/profile.yaml`
- Create: `tests/fixtures/portable-profile/minimal/manifest.yaml`
- Create: `tests/fixtures/portable-profile/bundled/profile.yaml`
- Create: `tests/fixtures/portable-profile/bundled/manifest.yaml`
- Modify: `src/types.ts`

**Step 1: Write the failing test**

Add tests that define the v1 contract:
- `manifest.yaml` must include `schemaVersion`
- `profile.yaml` must use canonical MCP kinds
- bundled MCPs must carry explicit `path`
- credential placeholders must be `${credentials.<key>}`

Use assertions like:

```ts
expect(manifest.schemaVersion).toBe(1);
expect(profile.mcps.github.kind).toBe('local');
expect(profile.mcps.github.source).toBe('npm');
expect(profile.mcps.internal.headers.Authorization).toBe('Bearer ${credentials.internal_api_key}');
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/portable-profile-schema.test.ts`
Expected: FAIL because manifest/profile types and fixtures are not defined in code yet.

**Step 3: Write minimal implementation**

Add portable profile types to `src/types.ts`:
- `PortableProfileManifest`
- `PortableCredentialSpec`
- `PortableProfileSource`
- any shared placeholder string type comments

Keep this step type-only. Do not implement pack/unpack logic yet.

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/portable-profile-schema.test.ts`
Expected: PASS with type-compatible fixture parsing.

**Step 5: Commit**

```bash
git add src/types.ts tests/portable-profile-schema.test.ts tests/fixtures/portable-profile
git commit -m "feat: define portable profile v1 schema"
```

### Task 2: Add MCP classification rules for live agent configs

**Files:**
- Create: `src/services/portable-mcp-classifier.ts`
- Create: `tests/portable-mcp-classifier.test.ts`
- Modify: `src/services/sync/agent-reader.ts`
- Modify: `src/services/agent-config-service.ts`

**Step 1: Write the failing test**

Add classification tests for live MCP entries:
- `npx -y @modelcontextprotocol/server-github` -> `local/npm`
- `node ./dist/index.js` with a local path -> `local/bundled`
- `https://...` style remote metadata -> `remote`
- unknown commands -> unsupported with explicit validation error

Use fixtures shaped like current `AgentMcpEntry`.

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/portable-mcp-classifier.test.ts`
Expected: FAIL because no classifier exists.

**Step 3: Write minimal implementation**

Implement `portable-mcp-classifier.ts` with:
- `classifyPortableMcp(...)`
- deterministic rules for `npm`, `bundled`, and `remote`
- a typed error for unsupported/ambiguous MCPs

Keep agent readers unchanged except for exposing enough metadata if needed later. Do not broaden parser scope more than necessary.

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/portable-mcp-classifier.test.ts`
Expected: PASS for all supported and rejected cases.

**Step 5: Commit**

```bash
git add src/services/portable-mcp-classifier.ts tests/portable-mcp-classifier.test.ts src/services/sync/agent-reader.ts src/services/agent-config-service.ts
git commit -m "feat: classify portable mcps from live agent config"
```

### Task 3: Add credential detection and placeholder rewriting

**Files:**
- Create: `src/services/credential-redaction-service.ts`
- Create: `tests/credential-redaction-service.test.ts`
- Modify: `src/types.ts`

**Step 1: Write the failing test**

Add tests that:
- mark likely secret env keys like `GITHUB_TOKEN`, `OPENAI_API_KEY`, `PASSWORD`
- mark secret headers like `Authorization`, `X-API-Key`
- preserve non-secret config values
- rewrite secret values to `${credentials.<normalized_key>}`
- emit manifest entries for required credentials

Example expectations:

```ts
expect(result.redacted.env?.GITHUB_TOKEN).toBe('${credentials.github_token}');
expect(result.credentials).toContainEqual({
  key: 'github_token',
  required: true,
  description: expect.stringContaining('GITHUB_TOKEN'),
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/credential-redaction-service.test.ts`
Expected: FAIL because no redaction service exists.

**Step 3: Write minimal implementation**

Implement:
- heuristic secret-key detection
- placeholder generation
- manifest credential entry generation
- support for env and headers

Do not add prompting yet. This task is pack-side redaction only.

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/credential-redaction-service.test.ts`
Expected: PASS with redacted output and stable credential keys.

**Step 5: Commit**

```bash
git add src/services/credential-redaction-service.ts tests/credential-redaction-service.test.ts src/types.ts
git commit -m "feat: redact credential values in portable profile packs"
```

### Task 4: Separate pack from profile-file export and support live-agent sources

**Files:**
- Create: `src/services/portable-profile-pack-service.ts`
- Create: `tests/portable-profile-pack-service.test.ts`
- Modify: `src/services/profile-export-service.ts`
- Modify: `src/commands/profile.ts`
- Modify: `src/mcp/server.ts`
- Modify: `src/ui/routes.ts`
- Modify: `web/src/App.tsx`

**Step 1: Write the failing test**

Add tests for pack service entrypoints:
- pack from an existing Brainctl profile
- pack from a live agent config (`claude`, `codex`, `gemini`)
- bundled MCP content is copied into archive staging
- manifest is written
- secret values are not written verbatim into archive files

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/portable-profile-pack-service.test.ts`
Expected: FAIL because pack service and new archive structure do not exist.

**Step 3: Write minimal implementation**

Implement a dedicated pack service with input modes:
- `{ source: 'profile', name: string }`
- `{ source: 'agent', agent: AgentName, cwd: string }`

Refactor existing profile export to delegate to this service rather than owning the archive layout itself.

Update interfaces:
- CLI should expose agent-based packing without breaking profile-based export
- MCP server tool and UI route should call the new service
- UI copy should say `Pack profile` or `Pack agent config` based on source

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/portable-profile-pack-service.test.ts`
Expected: PASS with generated archive containing `manifest.yaml`, `profile.yaml`, and bundled directories.

**Step 5: Commit**

```bash
git add src/services/portable-profile-pack-service.ts src/services/profile-export-service.ts src/commands/profile.ts src/mcp/server.ts src/ui/routes.ts web/src/App.tsx tests/portable-profile-pack-service.test.ts
git commit -m "feat: pack portable profiles from profile or live agent source"
```

### Task 5: Make unpack manifest-driven and stop guessing bundled paths

**Files:**
- Create: `tests/portable-profile-unpack-service.test.ts`
- Modify: `src/services/profile-import-service.ts`
- Modify: `src/types.ts`

**Step 1: Write the failing test**

Add unpack tests that verify:
- importer reads `manifest.yaml`
- bundled MCP source is resolved from the declared `path`, not hardcoded `mcps/<name>`
- archive with `./bundle/server` installs correctly
- invalid schema version is rejected cleanly

Include a regression for the reproduced bug:

```ts
await expect(service.execute({ cwd, archivePath })).resolves.toEqual(
  expect.objectContaining({ profileName: 'imported' })
);
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/portable-profile-unpack-service.test.ts`
Expected: FAIL because current importer hardcodes bundled source location and has no manifest validation.

**Step 3: Write minimal implementation**

Refactor import flow to:
- require and parse `manifest.yaml`
- validate `schemaVersion`
- resolve each bundled MCP from its declared relative `path`
- reject paths escaping the extracted archive root
- preserve deterministic output profile data

Keep old `profile import` command name for compatibility even if internals become portable-pack aware.

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/portable-profile-unpack-service.test.ts`
Expected: PASS with explicit-path bundle install working.

**Step 5: Commit**

```bash
git add src/services/profile-import-service.ts src/types.ts tests/portable-profile-unpack-service.test.ts
git commit -m "fix: unpack portable profiles using manifest-driven bundle paths"
```

### Task 6: Make overwrite robust and credential resolution explicit

**Files:**
- Create: `src/services/credential-resolution-service.ts`
- Create: `tests/credential-resolution-service.test.ts`
- Modify: `src/services/profile-import-service.ts`
- Modify: `src/commands/profile.ts`
- Modify: `src/ui/routes.ts`
- Modify: `web/src/App.tsx`

**Step 1: Write the failing test**

Add tests for:
- `--force` removing stale bundled files before copying
- missing required credentials causing a clear validation error
- supplied credential values populating env/header placeholders
- non-required credentials remaining unresolved without crashing

Include the stale-file regression:

```ts
expect(hasOld).toBe(false);
expect(hasNew).toBe(true);
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/credential-resolution-service.test.ts tests/portable-profile-unpack-service.test.ts`
Expected: FAIL because importer currently leaves stale files and has no placeholder resolution.

**Step 3: Write minimal implementation**

Implement credential resolution that can accept:
- explicit input map from CLI/API
- environment fallback

Change import flow to:
- delete target bundled MCP dir before overwrite
- replace `${credentials.key}` placeholders before persisting/installing
- surface which credentials are still missing

Add CLI/API parameters conservatively:
- CLI: `--credential key=value` repeatable option
- API/UI: JSON map such as `{ credentials: { github_token: "..." } }`

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/credential-resolution-service.test.ts tests/portable-profile-unpack-service.test.ts`
Expected: PASS with clean overwrite and resolved placeholders.

**Step 5: Commit**

```bash
git add src/services/credential-resolution-service.ts src/services/profile-import-service.ts src/commands/profile.ts src/ui/routes.ts web/src/App.tsx tests/credential-resolution-service.test.ts tests/portable-profile-unpack-service.test.ts
git commit -m "feat: resolve portable profile credentials and clean overwrite installs"
```

### Task 7: Add post-install validation so imported packs fail loudly, not later

**Files:**
- Create: `tests/portable-profile-install-preflight.test.ts`
- Modify: `src/services/profile-import-service.ts`
- Modify: `src/services/mcp-preflight-service.ts`
- Modify: `src/services/skill-preflight-service.ts`

**Step 1: Write the failing test**

Add tests for:
- bundled MCP install command failure surfaces a useful error
- installed local MCPs run through preflight after import
- remote MCP configs are validated for required metadata without attempting local install

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/portable-profile-install-preflight.test.ts`
Expected: FAIL because importer does not perform full post-install validation.

**Step 3: Write minimal implementation**

After import:
- run install commands for bundled MCPs
- run preflight for local MCPs
- skip command execution for remote MCPs but validate config completeness
- return structured installed/validated results

Keep failure messages explicit enough for platform and UI consumers.

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/portable-profile-install-preflight.test.ts`
Expected: PASS with deterministic validation outcomes.

**Step 5: Commit**

```bash
git add src/services/profile-import-service.ts src/services/mcp-preflight-service.ts src/services/skill-preflight-service.ts tests/portable-profile-install-preflight.test.ts
git commit -m "feat: validate imported portable profile installs"
```

### Task 8: Cover end-to-end CLI and web flows for profile sharing

**Files:**
- Modify: `tests/ui-server.test.ts`
- Create: `tests/profile-command-pack-import.test.ts`
- Modify: `src/commands/profile.ts`
- Modify: `src/ui/routes.ts`
- Modify: `README.md`
- Modify: `docs/plans/2026-03-29-brainctl-profile-platform-design.md`

**Step 1: Write the failing test**

Add end-to-end tests for:
- pack from a live agent through CLI
- pack from a profile through API
- import archive with credentials through API
- archive with bundled MCP under non-`mcps/<name>` path
- exported archive does not contain raw token values

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ui-server.test.ts tests/profile-command-pack-import.test.ts`
Expected: FAIL because current user flows do not expose the new source/credential contract.

**Step 3: Write minimal implementation**

Wire the final UX:
- CLI help text
- UI form labels and request payloads
- server route validation
- README examples for pack/import/register flows

Document:
- archive structure
- placeholder syntax
- credential requirements
- supported MCP portability classes
- unsupported MCP behavior

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/ui-server.test.ts tests/profile-command-pack-import.test.ts`
Expected: PASS with stable end-to-end flows.

**Step 5: Commit**

```bash
git add tests/ui-server.test.ts tests/profile-command-pack-import.test.ts src/commands/profile.ts src/ui/routes.ts web/src/App.tsx README.md docs/plans/2026-03-29-brainctl-profile-platform-design.md
git commit -m "docs: finalize portable profile pack and unpack flow"
```

### Task 9: Run the full verification suite before merging

**Files:**
- Modify: none expected unless failures expose gaps

**Step 1: Run targeted tests**

Run: `npx vitest run tests/portable-profile-schema.test.ts tests/portable-mcp-classifier.test.ts tests/credential-redaction-service.test.ts tests/portable-profile-pack-service.test.ts tests/portable-profile-unpack-service.test.ts tests/credential-resolution-service.test.ts tests/portable-profile-install-preflight.test.ts tests/profile-command-pack-import.test.ts tests/ui-server.test.ts`
Expected: all targeted pack/unpack tests PASS.

**Step 2: Run the full suite**

Run: `npm test`
Expected: full Vitest suite PASS.

**Step 3: Run the production build**

Run: `npm run build`
Expected: server and web build PASS.

**Step 4: Manual smoke check**

Run:

```bash
npm run dev -- profile export starter
npm run dev -- profile import ./starter.tar.gz --force
```

Expected:
- archive contains `manifest.yaml`
- imported bundled MCPs install cleanly
- no raw secrets are printed or persisted from placeholder-backed inputs

**Step 5: Commit**

```bash
git add .
git commit -m "chore: verify portable profile pack and unpack flow"
```

