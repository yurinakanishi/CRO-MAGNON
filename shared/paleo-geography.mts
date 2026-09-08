import { COAST_GRID, COAST_RUNS } from './paleo-coast-data.mjs';

export const EARTH = Object.freeze({
  width: 4096,
  height: 2048,
  minX: -2240,
  minZ: -416,
  maxX: 1856,
  maxZ: 1632,
  epochYearsBP: 50000,
  seaLevelMetres: -68.3,
});
export const geoToWorld = (longitude, latitude) => ({
  x: EARTH.minX + ((longitude + 180) / 360) * EARTH.width,
  z: EARTH.minZ + ((90 - latitude) / 180) * EARTH.height,
});
export const worldToGeo = (x, z) => ({
  longitude: ((x - EARTH.minX) / EARTH.width) * 360 - 180,
  latitude: 90 - ((z - EARTH.minZ) / EARTH.height) * 180,
});
const { width, height, cell } = COAST_GRID;
const coast = new Uint8Array(width * height);
let cursor = 0;
for (let i = 0; i < COAST_RUNS.length; i += 2) {
  coast.fill(COAST_RUNS[i + 1], cursor, cursor + COAST_RUNS[i]);
  cursor += COAST_RUNS[i];
}
if (cursor !== coast.length) throw new Error('Incomplete verified Earth shoreline');
COAST_RUNS.length = 0;
export const coastTextureData = () => ({ data: coast, width, height });
let components;
function buildComponents() {
  const labels = new Uint16Array(coast.length),
    queue = new Uint32Array(coast.length);
  let id = 0;
  for (let seed = 0; seed < coast.length; seed++) {
    if (coast[seed] <= 128 || labels[seed]) continue;
    if (++id > 65535) throw new Error('Too many shoreline components');
    let head = 0,
      tail = 1;
    queue[0] = seed;
    labels[seed] = id;
    while (head < tail) {
      const i = queue[head++],
        x = i % width,
        z = Math.floor(i / width);
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++) {
          if ((!dx && !dz) || x + dx < 0 || x + dx >= width || z + dz < 0 || z + dz >= height)
            continue;
          const j = i + dz * width + dx;
          if (coast[j] <= 128 || labels[j]) continue;
          labels[j] = id;
          queue[tail++] = j;
        }
    }
  }
  components = labels;
}
export function landmassAt(x, z) {
  if (!components) buildComponents();
  const ix = Math.max(0, Math.min(width - 1, Math.floor((x - EARTH.minX) / cell))),
    iz = Math.max(0, Math.min(height - 1, Math.floor((z - EARTH.minZ) / cell)));
  return components[iz * width + ix];
}
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
export function coastDistance(x, z) {
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(z) ||
    x < EARTH.minX ||
    x > EARTH.maxX ||
    z < EARTH.minZ ||
    z > EARTH.maxZ
  )
    return -32;
  const u = clamp((x - EARTH.minX) / cell - 0.5, 0, width - 1),
    v = clamp((z - EARTH.minZ) / cell - 0.5, 0, height - 1);
  const ix = Math.min(width - 2, Math.floor(u)),
    iz = Math.min(height - 2, Math.floor(v)),
    fx = u - ix,
    fz = v - iz,
    i = iz * width + ix;
  return (
    ((coast[i] * (1 - fx) + coast[i + 1] * fx) * (1 - fz) +
      (coast[i + width] * (1 - fx) + coast[i + width + 1] * fx) * fz -
      128) /
    4
  );
}
export const isLand = (x, z, margin = 0) => coastDistance(x, z) > margin;
export function landBodyFree(x, z, radius = 0) {
  const d = coastDistance(x, z);
  if (d > radius * 1.5 + 2) return true;
  if (d <= radius * 0.5) return false;
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    if (coastDistance(x + Math.cos(a) * radius, z + Math.sin(a) * radius) <= 0.05) return false;
  }
  return true;
}
export function chunkHasLand(x, z, size = 32) {
  for (let dz = -size / 2; dz <= size / 2; dz += cell)
    for (let dx = -size / 2; dx <= size / 2; dx += cell) if (isLand(x + dx, z + dz)) return true;
  return false;
}

// Broad MIS 3 game biomes. The shoreline comes from measured relief, not zones.
export const CLIMATE_ZONES = Object.freeze(
  [
    ['ice', -104, 67, 27, 14],
    ['ice', -125, 61, 7, 9],
    ['ice', -42, 74, 14, 12],
    ['ice', 16, 67, 6, 7],
    ['desert', 15, 24, 29, 10],
    ['desert', 46, 24, 15, 10],
    ['desert', 82, 39, 21, 8],
    ['desert', 20, -24, 8, 11],
    ['desert', 134, -26, 18, 11],
    ['desert', -112, 30, 11, 9],
    ['desert', -69, -24, 5, 13],
    ['snow', 82, 33, 14, 5],
    ['snow', -71, -48, 5, 10],
    ['snow', 169, -44, 5, 5],
    ['volcano', 43, 39.5, 5.5, 4.5],
    ['volcano', 36, -3, 5, 5],
    ['volcano', -69.5, -18, 3.5, 5],
    ['volcano', 138, 37, 2.6, 4],
    ['volcano', 111, -7, 5, 2],
    ['volcano', -122, 43, 3, 6],
    ['volcano', -19, 65, 3, 2],
  ].map((zone: [string, number, number, number, number]) => Object.freeze(zone)),
);
export const BIOME_IDS = Object.freeze(['grassland', 'snow', 'ice', 'volcano', 'desert']);
const smooth = (t) => ((t = clamp(t, 0, 1)), t * t * (3 - 2 * t));
export function geographicWeights(x, z) {
  const { longitude: lon, latitude: lat } = worldToGeo(x, z),
    w = [1, 0, 0, 0, 0];
  const snow = smooth((lat - 51) / 7);
  w[0] = 1 - snow;
  w[1] = snow;
  if (lat < -62) {
    const polar = smooth((-lat - 62) / 6);
    for (let i = 0; i < 5; i++) w[i] *= 1 - polar;
    w[2] += polar;
  }
  for (const [id, cx, cz, rx, rz] of CLIMATE_ZONES) {
    const d = Math.hypot((lon - cx) / rx, (lat - cz) / rz),
      weight = 1 - smooth((d - 0.78) / 0.3);
    if (!weight) continue;
    for (let i = 0; i < 5; i++) w[i] *= 1 - weight;
    w[BIOME_IDS.indexOf(id)] += weight;
  }
  return w;
}
export function geographicBiome(x, z) {
  const w = geographicWeights(x, z);
  return BIOME_IDS[w.indexOf(Math.max(...w))];
}
const stop = (id, name, lon, lat, continent) =>
  Object.freeze({ id, name, ...geoToWorld(lon, lat), continent });
export const EXPEDITION_STOPS = Object.freeze([
  Object.freeze({
    id: 'grassland',
    name: 'ヨーロッパの草原',
    x: 49,
    z: 52.4,
    continent: 'ヨーロッパ',
  }),
  stop('snow', 'シベリアの雪原', 60, 59, 'アジア'),
  stop('ice', 'スカンディナヴィアの氷床', 18, 67, 'ヨーロッパ'),
  stop('volcano', '西アジアの火山地帯', 43, 39.5, 'アジア'),
  stop('desert', 'サハラの砂漠', 15, 25, 'アフリカ'),
  stop('africa', '東アフリカの大地', 30, -5, 'アフリカ'),
  stop('east-asia', '東アジアの平原', 112, 34, 'アジア'),
  stop('sunda', 'スンダの大地', 110, 1, 'アジア'),
  stop('north-america', '北アメリカの平原', -103, 40, '北アメリカ'),
  stop('south-america', '南アメリカの平原', -56, -12, '南アメリカ'),
  stop('sahul', 'サフルの砂漠', 134, -26, 'オセアニア'),
  stop('greenland', 'グリーンランドの氷床', -42, 73, '北アメリカ'),
  stop('antarctica', '南極の氷の大地', 20, -78, '南極'),
]);
export const expeditionById = (id) => EXPEDITION_STOPS.find((s) => s.id === id);
export function locationName(x, z) {
  const nearest = EXPEDITION_STOPS.reduce((best, s) =>
    Math.hypot(s.x - x, s.z - z) < Math.hypot(best.x - x, best.z - z) ? s : best,
  );
  if (Math.hypot(nearest.x - x, nearest.z - z) < 80) return nearest.name;
  const { longitude: lon, latitude: lat } = worldToGeo(x, z);
  const continent =
    lat < -60
      ? '南極'
      : lon < -25
        ? lat < 13
          ? '南アメリカ'
          : '北アメリカ'
        : lon > 110 && lat < -10
          ? 'オセアニア'
          : lon < 52 && lat < 35 && lat > -38
            ? 'アフリカ'
            : lon < 45 && lat > 35
              ? 'ヨーロッパ'
              : 'アジア';
  return `${continent}の${{ grassland: '草原', snow: '雪原', ice: '氷床', desert: '砂漠', volcano: '火山地帯' }[geographicBiome(x, z)]}`;
}
export const CONTINENT_LABELS = Object.freeze(
  [
    ['北アメリカ', -108, 47],
    ['南アメリカ', -60, -19],
    ['ヨーロッパ', 12, 48],
    ['アフリカ', 19, 3],
    ['アジア', 89, 47],
    ['サフル', 136, -24],
    ['南極', 20, -79],
    ['グリーンランド', -42, 76],
  ].map(([name, lon, lat]) => Object.freeze({ name, ...geoToWorld(lon, lat) })),
);
