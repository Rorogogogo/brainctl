export interface BuildContextInput {
  memory: string;
  skill: string;
  input: string;
}

export function buildContext({ memory, skill, input }: BuildContextInput): string {
  const sections = [memory, skill, input].map((value) => value.replace(/\n+$/, ''));

  return [
    '--- MEMORY ---',
    sections[0],
    '',
    '--- SKILL ---',
    sections[1],
    '',
    '--- INPUT ---',
    sections[2]
  ].join('\n');
}
