import { WORLD } from './world.mjs';

// One continuous world. Centres are landmarks, not independent scenes or rooms.
export const BIOMES = Object.freeze([
  { id: 'grassland', name: 'はじまりの草原', short: '草原', ground: 'meadow-ground', x: 50, z: 50, radius: 76,
    color: '#889063', fog: '#b5c4b2', sky: '#bfd3cb', light: '#ffe4b5', density: .009, weather: 'clear', description: '森と草原、仲間の焚き火。' },
  { id: 'snow', name: '白銀の雪原', short: '雪原', ground: 'snow-ground', x: -125, z: -110, radius: 105,
    color: '#e5ebec', fog: '#c4d4e1', sky: '#c0d5e9', light: '#e1edff', density: .012, weather: 'snow', description: '雪をかぶった針葉樹と、静かな白い大地。' },
  { id: 'ice', name: '青氷の大地', short: '氷原', ground: 'ice-ground', x: 225, z: -120, radius: 110,
    color: '#78b9cf', fog: '#a8cddc', sky: '#aecfe5', light: '#d3ebff', density: .010, weather: 'snow', description: '青い氷壁の間を歩く、凍てついた湖。' },
  { id: 'volcano', name: '紅蓮の火山', short: '火山', ground: 'volcanic-ground', x: 230, z: 235, radius: 110,
    color: '#55504a', fog: '#8b7873', sky: '#807b82', light: '#ffd0a0', density: .012, weather: 'ash', description: '黒い玄武岩と、赤く光る火口。' },
  { id: 'desert', name: '金砂の砂漠', short: '砂漠', ground: 'desert-ground', x: -120, z: 230, radius: 112,
    color: '#cbaa6d', fog: '#d9c49b', sky: '#d8ceba', light: '#fff0cf', density: .0095, weather: 'sand', description: '風が砂を運ぶ、広い砂丘の道。' },
].map(Object.freeze));
export const biomeById = id => BIOMES.find(b => b.id === id);
export function biomeWeights(x, z) {
  const scores = BIOMES.map(b => Math.hypot(x - b.x, z - b.z) - b.radius);
  const nearest = Math.min(...scores);
  const weights = scores.map(score => Math.max(0, 1 - (score - nearest) / 36) ** 2);
  const sum = weights.reduce((a, b) => a + b, 0);
  return weights.map(w => w / sum);
}
export function biomeAt(x, z) {
  let best = BIOMES[0], score = Infinity;
  for (const b of BIOMES) {
    const d = Math.hypot(x - b.x, z - b.z) - b.radius;
    if (d < score) { score = d; best = b; }
  }
  return best;
}
export const chunkAt = (x, z) => ({ x: Math.floor((x - WORLD.minX) / WORLD.chunkSize), z: Math.floor((z - WORLD.minZ) / WORLD.chunkSize) });
export const chunkKey = (x, z) => `${x},${z}`;
export function chunkDescription(x, z) {
  const size = WORLD.chunkSize, cx = WORLD.minX + (x + .5) * size, cz = WORLD.minZ + (z + .5) * size;
  const quarterTurns=(Math.imul(x+71,73856093)^Math.imul(z+91,19349663))>>>0;
  return { key: chunkKey(x, z), ix: x, iz: z, x: cx, z: cz, size, yaw:(quarterTurns%4)*Math.PI/2, biome: biomeAt(cx, cz).id };
}
// A fixed working set; map area never determines GPU allocation.
export function nearbyChunks(x, z, radius = 112) {
  const cell = chunkAt(x, z), span = Math.ceil(radius / WORLD.chunkSize), count = WORLD.size / WORLD.chunkSize, result = [];
  for (let ix = Math.max(0, cell.x - span); ix <= Math.min(count - 1, cell.x + span); ix++) {
    for (let iz = Math.max(0, cell.z - span); iz <= Math.min(count - 1, cell.z + span); iz++) {
      const chunk = chunkDescription(ix, iz), distance = Math.hypot(chunk.x - x, chunk.z - z);
      if (distance <= radius + WORLD.chunkSize * Math.SQRT1_2) result.push({ ...chunk, distance });
    }
  }
  return result.sort((a, b) => a.distance - b.distance || a.ix - b.ix || a.iz - b.iz);
}

// These open corridors keep long journeys legible and the coarse path graph connected.
export const JOURNEY_STOPS = Object.freeze([
  { id: 'grassland', x: 49, z: 52.4 }, { id: 'snow', x: -115, z: -96 },
  { id: 'ice', x: 207, z: -107 }, { id: 'volcano', x: 210, z: 204 }, { id: 'desert', x: -104, z: 218 },
].map(Object.freeze));
export const JOURNEY_ROADS = Object.freeze([
  [{ x: 42, z: 43.5 }, { x: -115, z: -96 }], [{ x: 42, z: 60 }, { x: -104, z: 218 }],
  [{ x: 80, z: 43.5 }, { x: 207, z: -107 }], [{ x: 80, z: 43.5 }, { x: 210, z: 204 }],
]);
export function roadDistance(x, z) {
  let distance = Infinity;
  for (const [a, b] of JOURNEY_ROADS) {
    const dx = b.x - a.x, dz = b.z - a.z, t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz)));
    distance = Math.min(distance, Math.hypot(x - a.x - dx * t, z - a.z - dz * t));
  }
  return distance;
}
