// Set to true and rebuild to restore the retained grass models and placements.
// This affects decorative cover only; harvestable plants stay visible.
export const DECORATIVE_GRASS_ENABLED = false;

export function groundcoverVisible(key: string): boolean {
  return DECORATIVE_GRASS_ENABLED || (key !== 'meadow-grass' && key !== 'meadow-sprig');
}
