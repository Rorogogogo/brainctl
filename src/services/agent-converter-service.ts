import YAML from 'yaml';

export interface ParsedClaudeAgent {
  frontmatter: Record<string, unknown>;
  body: string;
}

export interface ParsedCodexAgent {
  name: string;
  description: string;
  developerInstructions: string;
  sandboxMode?: string;
  model?: string;
  extra: Record<string, unknown>;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export function parseMarkdownWithFrontmatter(source: string): ParsedClaudeAgent {
  const match = source.match(FRONTMATTER_RE);
  if (!match) {
    return { frontmatter: {}, body: source };
  }
  const parsed = YAML.parse(match[1]) as Record<string, unknown> | null;
  return {
    frontmatter: parsed ?? {},
    body: match[2],
  };
}

export function serializeMarkdownWithFrontmatter(
  frontmatter: Record<string, unknown>,
  body: string
): string {
  const keys = Object.keys(frontmatter);
  if (keys.length === 0) return body;
  const yaml = YAML.stringify(frontmatter).trimEnd();
  const normalizedBody = body.startsWith('\n') ? body : `\n${body}`;
  return `---\n${yaml}\n---${normalizedBody}`;
}

export function claudeAgentMdToCodexToml(source: string): string {
  const { frontmatter, body } = parseMarkdownWithFrontmatter(source);
  const name = String(frontmatter.name ?? '').trim();
  const description = String(frontmatter.description ?? '').trim();
  if (!name) throw new Error('Claude agent is missing required "name" frontmatter field.');
  if (!description) throw new Error('Claude agent is missing required "description" frontmatter field.');

  const sandboxMode = inferSandboxModeFromClaudeTools(frontmatter.tools);
  const lines: string[] = [];
  lines.push(`name = ${tomlString(name)}`);
  lines.push(`description = ${tomlString(description)}`);
  lines.push(`developer_instructions = ${tomlMultiline(body.trim())}`);
  if (sandboxMode) lines.push(`sandbox_mode = ${tomlString(sandboxMode)}`);
  return lines.join('\n') + '\n';
}

export function codexAgentTomlToClaudeMd(source: string): string {
  const parsed = parseCodexAgentToml(source);
  const frontmatter: Record<string, unknown> = {
    name: parsed.name,
    description: parsed.description,
  };
  if (parsed.sandboxMode) {
    frontmatter.tools = claudeToolsFromSandboxMode(parsed.sandboxMode);
  }
  return serializeMarkdownWithFrontmatter(frontmatter, `\n${parsed.developerInstructions.trim()}\n`);
}

export function claudeCommandMdToCodexSkill(source: string): {
  frontmatter: Record<string, unknown>;
  skillMarkdown: string;
} {
  const { frontmatter, body } = parseMarkdownWithFrontmatter(source);
  const description = String(frontmatter.description ?? '').trim();
  if (!description) {
    throw new Error('Claude command is missing required "description" frontmatter field.');
  }

  const skillFrontmatter: Record<string, unknown> = {
    description,
  };
  if (frontmatter['argument-hint']) {
    skillFrontmatter['argument-hint'] = frontmatter['argument-hint'];
  }

  return {
    frontmatter: skillFrontmatter,
    skillMarkdown: serializeMarkdownWithFrontmatter(skillFrontmatter, body.startsWith('\n') ? body : `\n${body}`),
  };
}

function inferSandboxModeFromClaudeTools(rawTools: unknown): string | undefined {
  const tools = normalizeClaudeToolList(rawTools);
  if (tools.length === 0) return undefined;
  const mutating = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
  return tools.some((tool) => mutating.has(tool)) ? 'workspace-write' : 'read-only';
}

function normalizeClaudeToolList(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((item) => String(item).trim()).filter(Boolean);
  if (typeof raw === 'string') {
    return raw.split(',').map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function claudeToolsFromSandboxMode(sandboxMode: string): string {
  const readOnlyTools = 'Glob, Grep, LS, Read, NotebookRead, WebFetch, WebSearch';
  if (sandboxMode === 'read-only') return readOnlyTools;
  return `${readOnlyTools}, Edit, Write, Bash`;
}

export function parseCodexAgentToml(source: string): ParsedCodexAgent {
  const lines = source.split('\n');
  const simple = new Map<string, string>();
  const extra: Record<string, unknown> = {};

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      i++;
      continue;
    }
    if (/^\[/.test(trimmed)) {
      i++;
      continue;
    }
    const kvMatch = trimmed.match(/^(\w+)\s*=\s*(.+)$/);
    if (!kvMatch) {
      i++;
      continue;
    }
    const [, key, rawValue] = kvMatch;

    if (rawValue.startsWith('"""')) {
      const { value, nextIndex } = readTomlMultiline(lines, i, rawValue);
      simple.set(key, value);
      i = nextIndex;
      continue;
    }

    simple.set(key, parseTomlScalar(rawValue));
    i++;
  }

  const name = simple.get('name');
  const description = simple.get('description');
  const developerInstructions = simple.get('developer_instructions');
  if (!name) throw new Error('Codex agent is missing required "name" field.');
  if (!description) throw new Error('Codex agent is missing required "description" field.');
  if (!developerInstructions) {
    throw new Error('Codex agent is missing required "developer_instructions" field.');
  }

  return {
    name,
    description,
    developerInstructions,
    sandboxMode: simple.get('sandbox_mode'),
    model: simple.get('model'),
    extra,
  };
}

function readTomlMultiline(
  lines: string[],
  startIndex: number,
  firstLine: string
): { value: string; nextIndex: number } {
  const afterOpen = firstLine.slice(3);
  if (afterOpen.endsWith('"""') && afterOpen.length >= 3) {
    return { value: unescapeTomlString(afterOpen.slice(0, -3)), nextIndex: startIndex + 1 };
  }

  const collected: string[] = [];
  if (afterOpen.length > 0) collected.push(afterOpen);
  let i = startIndex + 1;
  while (i < lines.length) {
    const line = lines[i];
    const closeIdx = line.indexOf('"""');
    if (closeIdx === -1) {
      collected.push(line);
      i++;
      continue;
    }
    if (closeIdx > 0) collected.push(line.slice(0, closeIdx));
    return { value: unescapeTomlString(collected.join('\n').replace(/^\n/, '')), nextIndex: i + 1 };
  }
  throw new Error('Unterminated TOML multiline string.');
}

function parseTomlScalar(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return unescapeTomlString(trimmed.slice(1, -1));
  }
  return trimmed;
}

function unescapeTomlString(value: string): string {
  return value
    .replace(/\\\\/g, '\\')
    .replace(/\\"/g, '"')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t');
}

function tomlString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function tomlMultiline(value: string): string {
  const escaped = value.replace(/"""/g, '\\"\\"\\"');
  return `"""\n${escaped}\n"""`;
}
