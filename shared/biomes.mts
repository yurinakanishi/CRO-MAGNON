import { WORLD } from './world.mjs';
import {
  geographicWeights,
  geographicBiome,
  expeditionById,
  EXPEDITION_STOPS,
  chunkHasLand,
} from './paleo-geography.mjs';
export const BIOMES = Object.freeze(
  [
    {
      id: 'grassland',
      short: '草原',
      ground: 'meadow-ground',
      color: '#889063',
      fog: '#b5c4b2',
      sky: '#bfd3cb',
      light: '#ffe4b5',
      density: 0.009,
      weather: 'clear',
      description: '草原から、氷河時代の大陸へ。',
    },
    {
      id: 'snow',
      short: '雪原',
      ground: 'snow-ground',
      color: '#e5ebec',
      fog: '#c4d4e1',
      sky: '#c0d5e9',
      light: '#e1edff',
      density: 0.012,
      weather: 'snow',
      description: '北の針葉樹林と、雪に覆われた大地。',
    },
    {
      id: 'ice',
      short: '氷床',
      ground: 'ice-ground',
      color: '#78b9cf',
      fog: '#a8cddc',
      sky: '#aecfe5',
      light: '#d3ebff',
      density: 0.01,
      weather: 'snow',
      description: '大陸を覆う氷と、青くそびえる氷壁。',
    },
    {
      id: 'volcano',
      short: '火山',
      ground: 'volcanic-ground',
      color: '#55504a',
      fog: '#8b7873',
      sky: '#807b82',
      light: '#ffd0a0',
      density: 0.012,
      weather: 'ash',
      description: '黒い大地と、火山のまわりを舞う灰。',
    },
    {
      id: 'desert',
      short: '砂漠',
      ground: 'desert-ground',
      color: '#cbaa6d',
      fog: '#d9c49b',
      sky: '#d8ceba',
      light: '#fff0cf',
      density: 0.0095,
      weather: 'sand',
      description: '低い海面の世界に広がる、乾いた砂の大地。',
    },
  ].map((b) => Object.freeze({ ...b, ...expeditionById(b.id), radius: 70 })),
);
export const biomeById = (id) => BIOMES.find((b) => b.id === id);
export const biomeWeights = geographicWeights;
export const biomeAt = (x, z) => biomeById(geographicBiome(x, z));
export const chunkAt = (x, z) => ({
  x: Math.floor((x - WORLD.minX) / WORLD.chunkSize),
  z: Math.floor((z - WORLD.minZ) / WORLD.chunkSize),
});
export const chunkKey = (x, z) => `${x},${z}`;
const descriptions = new Map();
export function chunkDescription(x, z) {
  const key = chunkKey(x, z);
  if (descriptions.has(key)) return descriptions.get(key);
  const size = WORLD.chunkSize,
    cx = WORLD.minX + (x + 0.5) * size,
    cz = WORLD.minZ + (z + 0.5) * size;
  const quarterTurns = (Math.imul(x + 71, 73856093) ^ Math.imul(z + 91, 19349663)) >>> 0;
  const result = {
    key,
    ix: x,
    iz: z,
    x: cx,
    z: cz,
    size,
    yaw: ((quarterTurns % 4) * Math.PI) / 2,
    biome: biomeAt(cx, cz).id,
    land: chunkHasLand(cx, cz, size),
  };
  if (descriptions.size >= 512) descriptions.delete(descriptions.keys().next().value);
  descriptions.set(key, result);
  return result;
}
export function nearbyChunks(x, z, radius = 112) {
  const cell = chunkAt(x, z),
    span = Math.ceil(radius / WORLD.chunkSize),
    nx = WORLD.width / WORLD.chunkSize,
    nz = WORLD.depth / WORLD.chunkSize,
    result = [];
  for (let ix = Math.max(0, cell.x - span); ix <= Math.min(nx - 1, cell.x + span); ix++)
    for (let iz = Math.max(0, cell.z - span); iz <= Math.min(nz - 1, cell.z + span); iz++) {
      const cx = WORLD.minX + (ix + 0.5) * 32,
        cz = WORLD.minZ + (iz + 0.5) * 32,
        distance = Math.hypot(cx - x, cz - z);
      if (distance <= radius + WORLD.chunkSize * Math.SQRT1_2)
        result.push({ ...chunkDescription(ix, iz), distance });
    }
  return result.sort((a, b) => a.distance - b.distance || a.ix - b.ix || a.iz - b.iz);
}
export const JOURNEY_STOPS = Object.freeze(EXPEDITION_STOPS.slice(0, 5));
// Local approaches stay clear; long journeys must follow the actual land.
export const JOURNEY_ROADS = Object.freeze(
  EXPEDITION_STOPS.map((s) => [
    { x: s.x - 10, z: s.z + 2 },
    { x: s.x + 10, z: s.z + 2 },
  ]),
);
export function roadDistance(x, z) {
  let distance = Infinity;
  for (const [a, b] of JOURNEY_ROADS) {
    const dx = b.x - a.x,
      dz = b.z - a.z,
      t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz)));
    distance = Math.min(distance, Math.hypot(x - a.x - dx * t, z - a.z - dz * t));
  }
  return distance;
}
