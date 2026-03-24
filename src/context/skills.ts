import { SkillNotFoundError } from '../errors.js';
import type { BrainctlConfig } from '../types.js';

export function resolveSkillPrompt(config: BrainctlConfig, skillName: string): string {
  const skill = config.skills[skillName];

  if (!skill) {
    throw new SkillNotFoundError(`Skill "${skillName}" is not defined in ai-stack.yaml.`);
  }

  return skill.prompt;
}
