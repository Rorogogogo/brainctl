# MCP Live Drag Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make live UI MCP drag/copy reliable for remote MCPs and strictly supported local MCPs across Claude, Codex, and Gemini.

**Architecture:** Keep live agent configs as the source of truth, but extend the live reader/UI mutation path to handle two MCP shapes: local and remote. Preserve exact local launcher semantics for a defined support matrix and fail closed on lossy conversions or unsupported launchers.

**Tech Stack:** TypeScript, Vitest, Node fs/json/toml config readers, React drag-and-drop UI

---

### Task 1: Add failing tests for remote live MCP support

**Files:**
- Modify: `tests/profiles-view.test.ts`
- Modify: `tests/ui-server.test.ts`
- Test: `tests/profiles-view.test.ts`
- Test: `tests/ui-server.test.ts`

**Step 1: Write the failing tests**

Add tests that assert:
- live agent payloads can include remote MCPs
- remote MCP staging does not require local `command` metadata
- apply helpers can POST a remote MCP payload

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/profiles-view.test.ts tests/ui-server.test.ts`
Expected: FAIL because remote MCP fields are missing or rejected.

**Step 3: Write minimal implementation**

Update the frontend/backend types and handlers just enough for the tests to pass.

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/profiles-view.test.ts tests/ui-server.test.ts`
Expected: PASS

### Task 2: Add failing tests for live reader remote MCP extraction

**Files:**
- Modify: `tests/portable-mcp-classifier.test.ts`
- Create: `tests/agent-reader.test.ts`
- Test: `tests/agent-reader.test.ts`

**Step 1: Write the failing test**

Add tests that assert the live readers populate `remoteMcpServers` when remote MCP config is present.

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/agent-reader.test.ts`
Expected: FAIL because readers currently return empty `remoteMcpServers`.

**Step 3: Write minimal implementation**

Teach readers to parse remote MCP fields from agent config.

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/agent-reader.test.ts`
Expected: PASS

### Task 3: Add failing tests for strict local launcher support

**Files:**
- Modify: `tests/mcp-preflight-service.test.ts`
- Modify: `tests/portable-profile-pack-service.test.ts`
- Test: `tests/mcp-preflight-service.test.ts`

**Step 1: Write the failing tests**

Add tests that assert:
- supported launchers validate with exact semantics
- unsupported launchers fail with clear messages
- `uvx` is preserved rather than silently rewritten to `npx`

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/mcp-preflight-service.test.ts tests/portable-profile-pack-service.test.ts`
Expected: FAIL because unsupported launchers are not blocked cleanly and `uvx` metadata is not preserved.

**Step 3: Write minimal implementation**

Tighten preflight and preserve launcher metadata in pack/import pathways.

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/mcp-preflight-service.test.ts tests/portable-profile-pack-service.test.ts`
Expected: PASS

### Task 4: Fix Gemini live path consistency

**Files:**
- Modify: `src/services/sync/agent-reader.ts`
- Modify: `src/services/agent-config-service.ts`
- Modify: `tests/ui-server.test.ts`

**Step 1: Write the failing test**

Add a test proving live read/write uses the same Gemini config file path.

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ui-server.test.ts`
Expected: FAIL because the read/write paths diverge.

**Step 3: Write minimal implementation**

Align direct mutation and read logic to the same Gemini config location.

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/ui-server.test.ts`
Expected: PASS

### Task 5: Verify focused MCP behavior

**Files:**
- Modify: `AGENTS.md` if verification guidance changes

**Step 1: Run focused verification**

Run: `npx vitest run tests/agent-reader.test.ts tests/profiles-view.test.ts tests/ui-server.test.ts tests/mcp-preflight-service.test.ts tests/portable-profile-pack-service.test.ts`
Expected: PASS

**Step 2: Run broader regression spot-check**

Run: `npm test`
Expected: PASS or a short list of unrelated failures to investigate immediately.
