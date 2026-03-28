export interface SkillDraft {
  id: string;
  name: string;
  description: string;
  prompt: string;
}

export interface McpDraft {
  id: string;
  name: string;
  json: string;
}

export interface SkillSavePayloadEntry {
  description?: string;
  prompt: string;
}

export type GuardedEditorView = 'skills' | 'mcp';
export type EditorNavigationDisposition = 'allow' | 'confirm' | 'blocked';

export class ConfigEditorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigEditorError';
  }
}

function createEmptySkillDraft(): SkillDraft {
  return {
    id: '',
    name: '',
    description: '',
    prompt: ''
  };
}

function createEmptyMcpDraft(): McpDraft {
  return {
    id: '',
    name: '',
    json: '{}'
  };
}

export function createSkillDraftsFromConfig(
  skills: Record<string, SkillSavePayloadEntry>
): SkillDraft[] {
  return Object.entries(skills)
    .sort(([leftName], [rightName]) => leftName.localeCompare(rightName))
    .map(([name, skill]) => ({
      id: `skill:${name}`,
      name,
      description: skill.description ?? '',
      prompt: skill.prompt
    }));
}

export function addSkillDraft(drafts: SkillDraft[]): SkillDraft[] {
  return [
    ...drafts,
    {
      ...createEmptySkillDraft(),
      id: createNextDraftId(drafts.map((draft) => draft.id), 'skill:new')
    }
  ];
}

export function updateSkillDraft(
  drafts: SkillDraft[],
  index: number,
  patch: Partial<SkillDraft>
): SkillDraft[] {
  if (index < 0 || index >= drafts.length) {
    return [...drafts];
  }

  return drafts.map((draft, currentIndex) =>
    currentIndex === index
      ? {
          ...draft,
          ...patch
        }
      : draft
  );
}

export function removeSkillDraft(drafts: SkillDraft[], index: number): SkillDraft[] {
  if (index < 0 || index >= drafts.length) {
    return [...drafts];
  }

  return drafts.filter((_, currentIndex) => currentIndex !== index);
}

export function createMcpDraftsFromConfig(mcps: Record<string, unknown>): McpDraft[] {
  return Object.entries(mcps)
    .sort(([leftName], [rightName]) => leftName.localeCompare(rightName))
    .map(([name, value]) => ({
      id: `mcp:${name}`,
      name,
      json: serializeMcpValueForEditing(value)
    }));
}

export function addMcpDraft(drafts: McpDraft[]): McpDraft[] {
  return [
    ...drafts,
    {
      ...createEmptyMcpDraft(),
      id: createNextDraftId(drafts.map((draft) => draft.id), 'mcp:new')
    }
  ];
}

export function updateMcpDraft(
  drafts: McpDraft[],
  index: number,
  patch: Partial<McpDraft>
): McpDraft[] {
  if (index < 0 || index >= drafts.length) {
    return [...drafts];
  }

  return drafts.map((draft, currentIndex) =>
    currentIndex === index
      ? {
          ...draft,
          ...patch
        }
      : draft
  );
}

export function removeMcpDraft(drafts: McpDraft[], index: number): McpDraft[] {
  if (index < 0 || index >= drafts.length) {
    return [...drafts];
  }

  return drafts.filter((_, currentIndex) => currentIndex !== index);
}

export function buildSkillSavePayload(drafts: SkillDraft[]): Record<string, SkillSavePayloadEntry> {
  if (drafts.length === 0) {
    throw new ConfigEditorError('At least one skill must be configured.');
  }

  const payload: Record<string, SkillSavePayloadEntry> = {};

  for (const draft of drafts) {
    const name = normalizeEntryName(draft.name, 'Skill');

    if (name in payload) {
      throw new ConfigEditorError(`Duplicate skill name "${name}".`);
    }

    const prompt = draft.prompt.trim();

    if (prompt.length === 0) {
      throw new ConfigEditorError(`Skill "${name}" must have a non-blank prompt.`);
    }

    const description = draft.description.trim();

    payload[name] = {
      prompt: draft.prompt,
      ...(description.length > 0 ? { description } : {})
    };
  }

  return payload;
}

export function areSkillDraftsDirty(
  drafts: SkillDraft[],
  skills: Record<string, SkillSavePayloadEntry>
): boolean {
  return JSON.stringify(stripSkillDraftIds(drafts)) !== JSON.stringify(
    stripSkillDraftIds(createSkillDraftsFromConfig(skills))
  );
}

export function parseMcpJsonPayload(payload: string): unknown {
  try {
    return JSON.parse(payload);
  } catch {
    throw new ConfigEditorError('MCP JSON payload could not be parsed.');
  }
}

export function buildMcpSavePayload(drafts: McpDraft[]): Record<string, unknown> {
  const payload: Record<string, unknown> = {};

  for (const draft of drafts) {
    const name = normalizeEntryName(draft.name, 'MCP entry');

    if (name in payload) {
      throw new ConfigEditorError(`Duplicate MCP entry "${name}".`);
    }

    try {
      payload[name] = parseMcpJsonPayload(draft.json);
    } catch (error) {
      if (error instanceof ConfigEditorError) {
        throw new ConfigEditorError(`MCP entry "${name}" contains invalid JSON.`);
      }

      throw error;
    }
  }

  return payload;
}

export function areMcpDraftsDirty(drafts: McpDraft[], mcps: Record<string, unknown>): boolean {
  return JSON.stringify(stripMcpDraftIds(drafts)) !== JSON.stringify(
    stripMcpDraftIds(createMcpDraftsFromConfig(mcps))
  );
}

export function serializeMcpValueForEditing(value: unknown): string {
  const serialized = JSON.stringify(value, null, 2);
  return serialized ?? '';
}

export function getEditorNavigationDisposition({
  activeView,
  nextView,
  isDirty,
  isSaving
}: {
  activeView: string;
  nextView: string;
  isDirty: boolean;
  isSaving: boolean;
}): EditorNavigationDisposition {
  if (activeView !== 'skills' && activeView !== 'mcp') {
    return 'allow';
  }

  if (activeView === nextView) {
    return 'allow';
  }

  if (isSaving) {
    return 'blocked';
  }

  if (isDirty) {
    return 'confirm';
  }

  return 'allow';
}

function normalizeEntryName(rawName: string, label: string): string {
  const name = rawName.trim();

  if (name.length === 0) {
    throw new ConfigEditorError(`${label} names must not be blank.`);
  }

  return name;
}

function stripSkillDraftIds(drafts: SkillDraft[]): Array<Omit<SkillDraft, 'id'>> {
  return drafts.map(({ id: _id, ...draft }) => draft);
}

function stripMcpDraftIds(drafts: McpDraft[]): Array<Omit<McpDraft, 'id'>> {
  return drafts.map(({ id: _id, ...draft }) => draft);
}

function createNextDraftId(existingIds: string[], prefix: string): string {
  let nextIndex = 1;

  for (const id of existingIds) {
    if (!id.startsWith(`${prefix}:`)) {
      continue;
    }

    const suffix = Number.parseInt(id.slice(prefix.length + 1), 10);
    if (Number.isFinite(suffix) && suffix >= nextIndex) {
      nextIndex = suffix + 1;
    }
  }

  return `${prefix}:${nextIndex}`;
}
