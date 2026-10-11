/** Retained characters. Set enabled to true to restore both playable looks and
 * their trader; source GLBs, portraits, animations and saved appearances stay intact. */
export const CHARACTER_ROSTER = [
  {
    species: 'nea',
    modelKeys: ['neanderthal-woman', 'neanderthal-hunter'],
    enabled: false,
  },
] as const;

export function characterSpeciesReleased(species: string | undefined): boolean {
  return !CHARACTER_ROSTER.some((entry) => entry.species === species && !entry.enabled);
}

export function characterModelReleased(modelKey: string): boolean {
  return !CHARACTER_ROSTER.some(
    (entry) => (entry.modelKeys as readonly string[]).includes(modelKey) && !entry.enabled,
  );
}
