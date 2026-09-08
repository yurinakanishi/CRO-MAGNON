import { biomeAt } from './biomes.mjs';

// Base geometry, UVs, textures and LODs are shared across the five regions.
// Surface treatments and appropriate placement provide the regional differences.
export const BIOME_SCENERY: Record<
  string,
  {
    tree?: string;
    treeHeight?: number;
    rock: string;
    rockHeight: number;
    shelter: string;
    hearth: string;
    wood: string;
    berry?: string;
    groundcover?: string;
    surface?: string;
  }
> = Object.freeze({
  grassland: Object.freeze({
    tree: 'valley-pine',
    treeHeight: 10,
    rock: 'valley-boulder',
    rockHeight: 1.7,
    shelter: 'hide-tent',
    hearth: 'stone-firepit',
    wood: 'firewood-pile',
    berry: 'berry-bush',
    groundcover: 'meadow-grass',
  }),
  snow: Object.freeze({
    tree: 'valley-pine',
    treeHeight: 10,
    rock: 'valley-boulder',
    rockHeight: 1.7,
    shelter: 'hide-tent',
    hearth: 'stone-firepit',
    wood: 'firewood-pile',
    berry: 'berry-bush',
    groundcover: 'berry-bush',
    surface: 'snow',
  }),
  ice: Object.freeze({
    tree: null,
    rock: 'valley-boulder',
    rockHeight: 1.7,
    shelter: 'hide-tent',
    hearth: 'stone-firepit',
    wood: null,
    berry: null,
    groundcover: null,
    surface: 'ice',
  }),
  volcano: Object.freeze({
    tree: null,
    rock: 'valley-boulder',
    rockHeight: 1.7,
    shelter: 'hide-tent',
    hearth: 'stone-firepit',
    wood: 'firewood-pile',
    berry: null,
    groundcover: null,
    surface: 'ash',
  }),
  desert: Object.freeze({
    tree: null,
    rock: 'valley-boulder',
    rockHeight: 1.7,
    shelter: 'hide-tent',
    hearth: 'stone-firepit',
    wood: 'firewood-pile',
    berry: null,
    groundcover: 'meadow-grass',
    surface: 'sand',
  }),
});

export function sceneryFor(x, z) {
  return BIOME_SCENERY[biomeAt(x, z).id];
}

// Client meshes and authoritative resource colliders must resolve identically.
export function resourceAppearance(resource) {
  if (resource.type === 'obsidian')
    return {
      key: 'valley-boulder',
      biome: 'grassland',
      surface: 'obsidian',
      scale: 0.55,
      yaw: resource.x * 0.2,
    };
  const biome = resource.appearanceBiome ?? biomeAt(resource.x, resource.z).id,
    palette = BIOME_SCENERY[biome];
  const key = resource.type === 'stone' ? palette.rock : palette[resource.type];
  if (!key) throw new Error(`No ${resource.type} resource model for ${biome}`);
  return {
    key,
    biome,
    surface: resource.id?.startsWith('gulf-') ? 'valley' : (palette.surface ?? null),
    scale: resource.type === 'stone' ? 0.935 / palette.rockHeight : 1,
    yaw: resource.x * 0.2,
  };
}
