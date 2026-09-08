import { WORLD } from './world.mjs';
import { CASTLE } from './castle-layout.mjs';
import { CASTLE_SURFACE } from './castle-surface.mjs';
import { BIOMES, biomeAt, chunkAt, chunkDescription } from './biomes.mjs';
import { coastDistance } from './paleo-geography.mjs';
export const WATER_LEVEL = -0.45;
export const riverX = (z) => 65 + Math.sin(z * 0.065) * 3.5;
export const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const smooth = (t) => ((t = clamp(t, 0, 1)), t * t * (3 - 2 * t));
export const riverFade = (z) => smooth((z + 64) / 24) * smooth((184 - z) / 24);
export const riverHalfWidth = (z) => 3.05 * riverFade(z);
let sourceSurface = null;
let sourceBridge = null;
export const riverBankDrop = (x, z) =>
  clamp((3.8 * riverFade(z) - Math.abs(x - riverX(z))) / 1.25, 0, 1) * 0.72;
export const coastBankDrop = (x, z) => 0.55 * (1 - smooth(coastDistance(x, z) / 4));

// The height samples come from ray queries against the exact reconstructed GLB.
// Only a shallow river-bank fitting offset is applied when placing the tiles.
export function installSourceTerrain(field) {
  const { resolution, heights, tileSize = 20, origin = -90 } = field;
  if (
    !Number.isInteger(resolution) ||
    resolution < 2 ||
    heights.length !== resolution ** 2 ||
    !heights.every(Number.isFinite) ||
    !(tileSize > 0)
  )
    throw new Error('Invalid source terrain height samples');
  const sampler = (x, z) => {
    const centreX = origin + Math.round((x - origin) / tileSize) * tileSize;
    const centreZ = origin + Math.round((z - origin) / tileSize) * tileSize;
    const u = clamp((x - centreX) / tileSize + 0.5, 0, 1) * (resolution - 1);
    const v = clamp((z - centreZ) / tileSize + 0.5, 0, 1) * (resolution - 1);
    const ix = Math.min(resolution - 2, Math.floor(u)),
      iz = Math.min(resolution - 2, Math.floor(v)),
      fx = u - ix,
      fz = v - iz;
    const a = heights[iz * resolution + ix] * (1 - fx) + heights[iz * resolution + ix + 1] * fx;
    const b =
      heights[(iz + 1) * resolution + ix] * (1 - fx) + heights[(iz + 1) * resolution + ix + 1] * fx;
    return a * (1 - fz) + b * fz;
  };
  sourceSurface = sampler;
  return () => {
    if (sourceSurface === sampler) sourceSurface = null;
  };
}

export function sampleHeightField(field, u, v) {
  const { resolution: n, heights } = field;
  u = clamp(u, 0, 1) * (n - 1);
  v = clamp(v, 0, 1) * (n - 1);
  const ix = Math.min(n - 2, Math.floor(u)),
    iz = Math.min(n - 2, Math.floor(v)),
    fx = u - ix,
    fz = v - iz;
  return (
    (heights[iz * n + ix] * (1 - fx) + heights[iz * n + ix + 1] * fx) * (1 - fz) +
    (heights[(iz + 1) * n + ix] * (1 - fx) + heights[(iz + 1) * n + ix + 1] * fx) * fz
  );
}
export function installBiomeTerrain(fields) {
  for (const biome of BIOMES) {
    const field = fields[biome.id];
    if (
      !field ||
      !Number.isInteger(field.resolution) ||
      field.resolution < 2 ||
      field.heights?.length !== field.resolution ** 2 ||
      !field.heights.every(Number.isFinite)
    ) {
      throw new Error(`Missing verified terrain samples: ${biome.id}`);
    }
  }
  const sampler = (x, z) => {
    const cell = chunkAt(x, z),
      chunk = chunkDescription(cell.x, cell.z);
    const dx = x - chunk.x,
      dz = z - chunk.z,
      c = Math.cos(chunk.yaw),
      s = Math.sin(chunk.yaw);
    return sampleHeightField(
      fields[chunk.biome],
      (c * dx - s * dz) / WORLD.chunkSize + 0.5,
      (s * dx + c * dz) / WORLD.chunkSize + 0.5,
    );
  };
  sourceSurface = sampler;
  return () => {
    if (sourceSurface === sampler) sourceSurface = null;
  };
}

export function terrainHeight(x, z) {
  if (sourceSurface) return sourceSurface(x, z) - riverBankDrop(x, z) - coastBankDrop(x, z);
  // Neutral height is used only by unloaded/invisible actors; no legacy terrain is drawn.
  return 0;
}

export function walkHeight(x, z) {
  const castleHeight = CASTLE_SURFACE.height(x, z);
  if (Number.isFinite(castleHeight))
    return terrainHeight(CASTLE.x, CASTLE.z) + CASTLE.groundOffset + castleHeight;
  if (sourceBridge) {
    const bridge = sourceBridge,
      lx = x - bridge.x,
      lz = z - bridge.z;
    if (
      lx >= bridge.bounds.minX &&
      lx <= bridge.bounds.maxX &&
      lz >= bridge.bounds.minZ &&
      lz <= bridge.bounds.maxZ
    )
      return bridge.deckY;
    return terrainHeight(x, z);
  }
  return terrainHeight(x, z);
}
export function projectileHeight(x, z, elevation = 0) {
  return (
    (CASTLE_SURFACE.cell(x, z) ? terrainHeight(CASTLE.x, CASTLE.z) : terrainHeight(x, z)) +
    elevation
  );
}
export function installSourceBridge(bounds, x = riverX(43.5), z = 43.5, deckY = 0.3) {
  if (
    ![bounds.minX, bounds.maxX, bounds.minZ, bounds.maxZ, x, z, deckY].every(Number.isFinite) ||
    bounds.minX >= bounds.maxX ||
    bounds.minZ >= bounds.maxZ
  )
    throw new Error('Invalid source bridge bounds');
  const bridge = { bounds: { ...bounds }, x, z, deckY };
  sourceBridge = bridge;
  return () => {
    if (sourceBridge === bridge) sourceBridge = null;
  };
}
export function movementFromCamera(sx, sy, yaw) {
  const length = Math.max(1, Math.hypot(sx, sy));
  return {
    dx: (sx * Math.cos(yaw) + sy * Math.sin(yaw)) / length,
    dz: (-sx * Math.sin(yaw) + sy * Math.cos(yaw)) / length,
  };
}
