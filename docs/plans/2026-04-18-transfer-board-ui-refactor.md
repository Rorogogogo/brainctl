# Transfer Board UI Refactor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reduce coupling in the Transfer Board UI without changing current behavior or the new visual direction.

**Architecture:** Keep the current React + Tailwind UI, but split the work by feature boundary instead of leaving API calls, DnD rules, render trees, and board state in `App.tsx` and `ProfilesView.tsx`. Move pure logic into testable modules first, then extract presentational components, then shrink the root files down to orchestration shells.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind v4, Vitest

---

### Task 1: Extract DnD Parsing And Collision Rules

**Files:**
- Create: `web/src/profiles-board/dnd.ts`
- Create: `tests/profiles-dnd.test.ts`
- Modify: `web/src/ProfilesView.tsx`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { parseDragId, parseDropId, resolveCrossAgentDropId } from '../web/src/profiles-board/dnd.js';

describe('profiles board dnd helpers', () => {
  it('maps a dragged skill onto the target skills anchor', () => {
    expect(resolveCrossAgentDropId('claude:skill:notes', 'codex:column')).toBe('codex:skills:anchor');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/profiles-dnd.test.ts`
Expected: FAIL because `web/src/profiles-board/dnd.ts` does not exist yet.

**Step 3: Write minimal implementation**

```ts
export function parseDragId(id: string) { /* move from ProfilesView.tsx */ }
export function parseDropId(id: string) { /* move from ProfilesView.tsx */ }
export function resolveCrossAgentDropId(activeId: string, overId: string) { /* pure mapping */ }
export const customCollisionDetection: CollisionDetection = (args) => { /* compose helpers */ };
```

**Step 4: Update the view**

Replace the inline parsing/collision helpers in `web/src/ProfilesView.tsx` with imports from `web/src/profiles-board/dnd.ts`.

**Step 5: Run tests**

Run: `npx vitest run tests/profiles-dnd.test.ts tests/profiles-view.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add web/src/profiles-board/dnd.ts tests/profiles-dnd.test.ts web/src/ProfilesView.tsx
git commit -m "refactor: extract transfer board dnd helpers"
```

### Task 2: Extract Profiles Board Presentation Components

**Files:**
- Create: `web/src/profiles-board/DraggableCard.tsx`
- Create: `web/src/profiles-board/StaticCard.tsx`
- Create: `web/src/profiles-board/DroppableZone.tsx`
- Create: `web/src/profiles-board/AgentColumn.tsx`
- Create: `web/src/profiles-board/PendingChangesBar.tsx`
- Modify: `web/src/ProfilesView.tsx`

**Step 1: Move the smallest component first**

Start with `DraggableCard.tsx` and keep props identical to the current inline component so behavior stays unchanged.

```tsx
export interface DraggableCardProps {
  id: string;
  label: string;
  sublabel: string;
  status?: 'added' | 'removed';
  editable: boolean;
}
```

**Step 2: Move the remaining view primitives**

Extract `StaticCard`, `DroppableZone`, `AgentColumn`, and `PendingChangesBar` one at a time, preserving current JSX and class names.

**Step 3: Keep `ProfilesView.tsx` focused on orchestration**

After extraction, `ProfilesView.tsx` should mostly contain:

```tsx
const previewConfigs = applyPendingChanges(agentConfigs, pendingChanges);
return (
  <>
    <PendingChangesBar ... />
    <DndContext ...>
      {previewConfigs.map((config) => <AgentColumn key={config.agent} ... />)}
    </DndContext>
  </>
);
```

**Step 4: Run verification**

Run: `npx vitest run tests/profiles-view.test.ts`
Expected: PASS

Run: `npm run build`
Expected: PASS

**Step 5: Commit**

```bash
git add web/src/profiles-board/*.tsx web/src/ProfilesView.tsx
git commit -m "refactor: split profiles board components"
```

### Task 3: Move Profiles Board State And API Flow Behind A Hook

**Files:**
- Create: `web/src/profiles-board/useProfilesBoard.ts`
- Create: `web/src/lib/fetch-json.ts`
- Modify: `web/src/ProfilesView.tsx`
- Modify: `web/src/App.tsx`

**Step 1: Extract the shared frontend fetch helper**

```ts
export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(...);
  return response.json() as Promise<T>;
}
```

**Step 2: Move board state orchestration into a hook**

The hook should own:
- `agentConfigs`
- `pendingChanges`
- `loading`
- `saving`
- `confirmOpen`
- `activeId`
- `fetchLiveConfigs`
- `handleDragStart`
- `handleDragEnd`
- `handleSave`
- `handleConfirmSave`

**Step 3: Keep view files free of request code**

After this step, `ProfilesView.tsx` should read like:

```tsx
const board = useProfilesBoard();
return <ProfilesBoardLayout {...board} />;
```

**Step 4: Run verification**

Run: `npx vitest run tests/profiles-view.test.ts tests/profiles-dnd.test.ts`
Expected: PASS

Run: `npm run build`
Expected: PASS

**Step 5: Commit**

```bash
git add web/src/profiles-board/useProfilesBoard.ts web/src/lib/fetch-json.ts web/src/ProfilesView.tsx web/src/App.tsx
git commit -m "refactor: move profiles board state into hook"
```

### Task 4: Split The App Shell Into Header And Action Panels

**Files:**
- Create: `web/src/transfer-board/AppHeader.tsx`
- Create: `web/src/transfer-board/PackPanel.tsx`
- Create: `web/src/transfer-board/InstallPanel.tsx`
- Create: `web/src/transfer-board/types.ts`
- Modify: `web/src/App.tsx`

**Step 1: Move App-specific types**

Move these out of `App.tsx`:
- `ProfilesResponse`
- `ProfilePreview`
- `SkillPreview`
- `AgentLivePreview`
- `ActionPanel`

**Step 2: Extract the header**

`AppHeader.tsx` should receive all current header props instead of reading state directly.

```tsx
export function AppHeader(props: {
  activePanel: 'pack' | 'install' | null;
  onTogglePack: () => void;
  onToggleInstall: () => void;
}) { ... }
```

**Step 3: Extract the pack flow**

Move the pack form plus preview card into `PackPanel.tsx`.

**Step 4: Extract the install flow**

Move the install form and explanatory side panel into `InstallPanel.tsx`.

**Step 5: Reduce `App.tsx` to a shell**

After extraction, `App.tsx` should mainly:
- load shared profile data
- own which panel is open
- render `<AppHeader />`
- render `<PackPanel />` or `<InstallPanel />`
- render `<ProfilesView />` when no panel is open

**Step 6: Run verification**

Run: `npm run build`
Expected: PASS

**Step 7: Commit**

```bash
git add web/src/transfer-board/*.tsx web/src/transfer-board/types.ts web/src/App.tsx
git commit -m "refactor: split transfer board app shell"
```

### Task 5: Remove Avoidable External Branding Dependencies

**Files:**
- Modify: `web/index.html`
- Modify: `web/src/styles.css`
- Create: `web/public/brainctl-mark.svg`
- Modify: `web/src/App.tsx`

**Step 1: Promote a real local brand asset**

Copy the canonical mark from `assets/logo-mark.svg` into `web/public/brainctl-mark.svg` so the header does not rely on the favicon asset as its main logo.

**Step 2: Remove the Google Fonts dependency**

Delete:

```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400..700&display=swap" rel="stylesheet" />
```

**Step 3: Use a local/system font stack**

Keep typography local to avoid network dependency in a local dashboard.

**Step 4: Run verification**

Run: `npm run build`
Expected: PASS

**Step 5: Commit**

```bash
git add web/index.html web/src/styles.css web/public/brainctl-mark.svg web/src/App.tsx
git commit -m "refactor: use local brand assets in transfer board"
```

### Task 6: Final Regression Pass

**Files:**
- Modify: `tests/profiles-view.test.ts`
- Optionally create: `tests/transfer-board-ui.test.ts`

**Step 1: Cover the new extracted pure logic**

Expand tests to cover:
- same-agent drag rejection
- cross-agent anchor resolution
- duplicate staging rejection after refactor

**Step 2: Run the focused test suite**

Run: `npx vitest run tests/profiles-dnd.test.ts tests/profiles-view.test.ts`
Expected: PASS

**Step 3: Run project verification**

Run: `npm run build`
Expected: PASS

**Step 4: Commit**

```bash
git add tests/profiles-dnd.test.ts tests/profiles-view.test.ts
git commit -m "test: cover transfer board refactor"
```
