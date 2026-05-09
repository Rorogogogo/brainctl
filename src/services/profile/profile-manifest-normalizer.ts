import type { PortableProfileManifest, PortableUserSkillSnapshot } from '../../types.js';

export function normalizePortableProfileManifest(
  manifest: PortableProfileManifest
): PortableProfileManifest {
  const pluginOwnedUserSkills = new Set(
    (manifest.plugins ?? []).flatMap((plugin) =>
      [...(plugin.pluginSkills ?? []), ...(plugin.pluginCommands ?? [])].map(
        (skillName) => `${plugin.agent}:${skillName}`
      )
    )
  );

  if (pluginOwnedUserSkills.size === 0 || !manifest.userSkills) {
    return manifest;
  }

  const userSkills = manifest.userSkills.filter(
    (skill) => !pluginOwnedUserSkills.has(userSkillKey(skill))
  );

  return {
    ...manifest,
    userSkills,
  };
}

function userSkillKey(skill: PortableUserSkillSnapshot): string {
  return `${skill.agent}:${skill.name}`;
}
