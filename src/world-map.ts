import { FISHING_SITES } from '../shared/fishing-sites.mjs';
import { BEHEMOTH, BEHEMOTH_GROUND, BEHEMOTH_MARSH } from '../shared/behemoth-rules.mjs';
import { SABERTOOTH, SABERTOOTH_GROUND } from '../shared/sabertooth-rules.mjs';
import { HOUSEHOLDS } from '../shared/household-sites.mjs';
import { SEA_WEATHER, currentDirection, seaConditions } from '../shared/maritime-weather.mjs';
import { SHELL_BEDS, MIDDEN_SITES, KNAPPING_SITES } from '../shared/coastal-sites.mjs';
import { WORLD, worldClamp, CAMP, NPC } from '../shared/world.mjs';
import { BIOMES, biomeAt, biomeWeights } from '../shared/biomes.mjs';
import {
  EARTH,
  coastDistance,
  CONTINENT_LABELS,
  EXPEDITION_STOPS,
  coastlineContours,
  geoToWorld,
} from '../shared/paleo-geography.mjs';
import { LANDMARKS } from '../shared/landmarks.mjs';
import { WARP_POINTS } from '../shared/warp-sites.mjs';
import { CASTLE, CASTLE_GATE } from '../shared/castle-layout.mjs';
import { ENEMY_RULES } from '../shared/enemies.mjs';
import { HUNTING } from '../shared/hunting.mjs';
import { enemyStatusLabel } from './enemy-state.js';
import {
  MAP_ARROW_PATH,
  MAP_ARROW_POINTS,
  MAP_ARROW_SIZE,
  MAP_TIERS,
  MAP_ZOOM,
  markerRotation,
  placeLabels,
  type LabelRect,
} from './map-layout.js';
import {
  COUNTRIES,
  GULF,
  SETTLEMENTS,
  GULF_SPINE,
  MANY_HEARTHS,
  OBSIDIAN_OUTCROPS,
  SPRINGS,
  FARM_PLOTS,
  LANDINGS,
  GULF_STOPS,
  GULF_LANDMARKS,
  inGulf,
} from '../shared/gulf-region.mjs';
import {
  ADVENTURE_REGIONS,
  regionAt,
  RIFTS,
  adventureProgress,
} from '../shared/adventure-regions.mjs';

let background,
  selection = null;
let mapZoom = 1,
  mapCenter = null;
/** Fire ids whose name label found room in the last big draw; the DOM shows exactly these. */
let fireLabelIds = new Set<string>();
/** One seamless projection: the whole earth and the gulf share a plane, 1× to 32×. */
export const ATLAS_BOUNDS = Object.freeze({
  minX: Math.min(EARTH.minX, GULF.minX),
  maxX: Math.max(EARTH.maxX, GULF.maxX),
  minZ: Math.min(EARTH.minZ, GULF.minZ),
  maxZ: Math.max(EARTH.maxZ, GULF.maxZ),
  width: Math.max(EARTH.maxX, GULF.maxX) - Math.min(EARTH.minX, GULF.minX),
  depth: Math.max(EARTH.maxZ, GULF.maxZ) - Math.min(EARTH.minZ, GULF.minZ),
});
const clampZoom = (zoom) => Math.max(MAP_ZOOM.min, Math.min(MAP_ZOOM.max, zoom));
/** Opens the atlas on a point at a zoom; without a point it shows the whole world at 1×. */
export function resetWorldMap(point = null, zoom = 1) {
  markMapMoved();
  mapZoom = clampZoom(zoom);
  mapCenter = point ? { x: point.x, z: point.z } : null;
}
/** Kept for callers that only reset the view; the atlas no longer has range modes. */
export function setWorldMapMode(_mode?: string) {
  resetWorldMap();
}
export function worldMapFireLabels() {
  return fireLabelIds;
}
export function centerWorldMap(point) {
  markMapMoved();
  mapCenter = { x: point.x, z: point.z };
}
export function zoomWorldMap(
  canvas,
  self,
  factor,
  anchor = { x: canvas.width / 2, y: canvas.height / 2 },
) {
  markMapMoved();
  const before = mapProjection(canvas, true, self);
  const world = before.world(anchor.x, anchor.y);
  mapZoom = clampZoom(mapZoom * factor);
  const after = mapProjection(canvas, true, self);
  mapCenter = {
    x: worldClamp(world.x - (anchor.x - canvas.width / 2) / after.scale, 'x'),
    z: worldClamp(world.z - (anchor.y - canvas.height / 2) / after.scale, 'z'),
  };
}
export function panWorldMap(canvas, self, dx, dy) {
  markMapMoved();
  const projection = mapProjection(canvas, true, self);
  const center = projection.world(canvas.width / 2 - dx, canvas.height / 2 - dy);
  centerWorldMap(center);
}
export function setWorldMapSelection(point) {
  selection = point;
}
/** The minimap's fixed 2048 × 1024 raster: it never zooms, so one bitmap stays sharp. */
function baseMap() {
  if (background) return background;
  const width = 2048,
    height = 1024,
    canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d'),
    pixels = ctx.createImageData(width, height);
  for (let z = 0; z < height; z++)
    for (let x = 0; x < width; x++) {
      const wx = WORLD.minX + ((x + 0.5) / width) * WORLD.width,
        wz = WORLD.minZ + ((z + 0.5) / height) * WORLD.depth,
        i = (z * width + x) * 4;
      localColor(wx, wz, pixels.data, i);
      pixels.data[i + 3] = 255;
    }
  ctx.putImageData(pixels, 0, 0);
  background = canvas;
  return canvas;
}
let palette: number[][] | null = null;
const ATLAS_LAND_BASE = [35, 37, 22];
/** The biome colours as RGB triples, parsed once from the shared palette. */
const biomeColors = () =>
  (palette ??= BIOMES.map((b) =>
    b.color
      .slice(1)
      .match(/../g)
      .map((n) => parseInt(n, 16)),
  ));
/** The minimap palette of one world point, written into `out` at `i`. */
function localColor(wx: number, wz: number, out: Uint8ClampedArray | number[], i: number) {
  const colors = biomeColors();
  const d = coastDistance(wx, wz);
  if (d > 0) {
    const weights = biomeWeights(wx, wz),
      shade = 0.78 + Math.min(d, 6) / 60;
    for (let c = 0; c < 3; c++)
      out[i + c] = weights.reduce((sum, w, j) => sum + w * colors[j][c], 0) * shade;
  } else {
    const coast = Math.max(0, 1 + d / 16);
    out[i] = 25 + coast * 24;
    out[i + 1] = 57 + coast * 31;
    out[i + 2] = 72 + coast * 30;
  }
  return d;
}
/**
 * Atlas terrain is recomputed for the visible rectangle at screen resolution, so zooming never
 * magnifies pixels. The two inputs cost very different amounts: `coastDistance` is a grid
 * lookup (~10 ns) while `biomeWeights` is climate geometry (~1.1 µs, far too slow for 576 000
 * screen pixels). So the coast shading — everything the eye reads as shape — is computed per
 * pixel, and the biome colour is taken from a lattice a few metres apart and interpolated,
 * which is finer than the climate zones themselves vary. While the view is still moving both
 * drop by a factor of two and the result is upscaled.
 */
const TERRAIN = Object.freeze({
  fine: 1,
  coarse: 2,
  /** Metres between biome-colour samples; the climate bands are an order of magnitude wider. */
  latticeMetres: 4,
  refineMs: 120,
});
let terrain: { key: string; canvas: HTMLCanvasElement } | null = null;
let movedAt = -Infinity;
let refineTimer: ReturnType<typeof setTimeout> | null = null;
const mapNow = () =>
  typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
/** Every view change marks the atlas as moving, which halves the fill until it settles. */
function markMapMoved() {
  movedAt = mapNow();
}
/** Screen pixels per filled pixel: coarse while the view moves, fine once it settles. */
export function worldMapTerrainSample() {
  return mapNow() - movedAt < TERRAIN.refineMs ? TERRAIN.coarse : TERRAIN.fine;
}
function atlasTerrain(canvas, projection) {
  const { scale, center } = projection,
    w = canvas.width,
    h = canvas.height,
    sample = worldMapTerrainSample();
  const key = `${w}x${h}|${scale.toFixed(4)}|${center.x.toFixed(2)},${center.z.toFixed(2)}|${sample}`;
  if (terrain?.key === key) return terrain.canvas;
  const cw = Math.max(1, Math.ceil(w / sample)),
    ch = Math.max(1, Math.ceil(h / sample)),
    tile = document.createElement('canvas');
  tile.width = cw;
  tile.height = ch;
  const ctx = tile.getContext('2d'),
    pixels = ctx.createImageData(cw, ch),
    data = pixels.data;
  const world = (px: number, py: number) => ({
    x: center.x + ((px + 0.5) * sample - w / 2) / scale,
    z: center.z + ((py + 0.5) * sample - h / 2) / scale,
  });
  // The biome lattice, in filled pixels: never denser than 2 px, never coarser than 24.
  const span = Math.max(2, Math.min(24, Math.round((TERRAIN.latticeMetres * scale) / sample)));
  const lw = Math.ceil(cw / span) + 1,
    lh = Math.ceil(ch / span) + 1,
    lattice = new Float32Array(lw * lh * 3),
    colors = biomeColors();
  for (let ly = 0; ly < lh; ly++)
    for (let lx = 0; lx < lw; lx++) {
      const p = world(lx * span, ly * span),
        weights = biomeWeights(p.x, p.z),
        at = (ly * lw + lx) * 3;
      for (let c = 0; c < 3; c++)
        lattice[at + c] = weights.reduce((sum, weight, j) => sum + weight * colors[j][c], 0);
    }
  for (let py = 0; py < ch; py++) {
    const wz = center.z + ((py + 0.5) * sample - h / 2) / scale;
    const ly = Math.min(lh - 2, Math.floor(py / span)),
      tz = py / span - ly;
    for (let px = 0; px < cw; px++) {
      const wx = center.x + ((px + 0.5) * sample - w / 2) / scale,
        i = (py * cw + px) * 4;
      if (wx < WORLD.minX || wx > WORLD.maxX || wz < WORLD.minZ || wz > WORLD.maxZ) continue;
      const d = coastDistance(wx, wz);
      if (d > 0) {
        const lx = Math.min(lw - 2, Math.floor(px / span)),
          tx = px / span - lx,
          a = (ly * lw + lx) * 3,
          b = a + 3,
          c0 = ((ly + 1) * lw + lx) * 3,
          d0 = c0 + 3,
          shade = (0.78 + Math.min(d, 6) / 60) * 0.66;
        for (let c = 0; c < 3; c++)
          data[i + c] =
            (lattice[a + c] * (1 - tx) * (1 - tz) +
              lattice[b + c] * tx * (1 - tz) +
              lattice[c0 + c] * (1 - tx) * tz +
              lattice[d0 + c] * tx * tz) *
              shade +
            ATLAS_LAND_BASE[c];
      } else {
        const coast = Math.max(0, 1 + d / 16);
        data[i] = 17 + coast * 12;
        data[i + 1] = 45 + coast * 20.15;
        data[i + 2] = 52 + coast * 18;
      }
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(pixels, 0, 0);
  terrain = { key, canvas: tile };
  return tile;
}
/** After the view settles, ask the atlas for one more draw so the fine fill replaces the coarse. */
function scheduleRefine(canvas) {
  if (typeof setTimeout !== 'function') return;
  if (refineTimer) clearTimeout(refineTimer);
  refineTimer = setTimeout(() => {
    refineTimer = null;
    canvas.dispatchEvent?.(new Event('maprefine'));
  }, TERRAIN.refineMs + 20);
}
let coastPath: Path2D | null = null;
/** The shoreline polylines in world space, built once and stroked under the map transform. */
function coastlinePath() {
  if (coastPath || typeof Path2D === 'undefined') return coastPath;
  coastPath = new Path2D();
  for (const line of coastlineContours()) {
    coastPath.moveTo(line[0].x, line[0].z);
    for (let i = 1; i < line.length; i++) coastPath.lineTo(line[i].x, line[i].z);
  }
  return coastPath;
}
/** Runs `draw` with world metres as the drawing unit, so world-space paths stroke directly. */
function withMapTransform(ctx, projection, w: number, h: number, draw: () => void) {
  const { scale, center } = projection;
  ctx.save();
  ctx.translate(w / 2 - center.x * scale, h / 2 - center.z * scale);
  ctx.scale(scale, scale);
  draw();
  ctx.restore();
}
/**
 * The shoreline as a vector line, one screen pixel wide at every zoom (1.5 px once the coast
 * fills the view). Drawn under the world transform, so widths are divided by the scale.
 */
function strokeCoastline(ctx, scale: number, zoom: number) {
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#aab089dd';
  ctx.lineWidth = (zoom >= MAP_TIERS.sites ? 1.5 : 1) / scale;
  const path = coastlinePath();
  if (path) ctx.stroke(path);
  else {
    ctx.beginPath();
    for (const line of coastlineContours()) {
      ctx.moveTo(line[0].x, line[0].z);
      for (let i = 1; i < line.length; i++) ctx.lineTo(line[i].x, line[i].z);
    }
    ctx.stroke();
  }
}
/** The gulf road: a dashed hint from afar, a two-tone road once the walk itself is readable. */
function strokeGulfSpine(ctx, point, zoom: number) {
  const trace = () => {
    ctx.beginPath();
    GULF_SPINE.forEach((p, i) =>
      i ? ctx.lineTo(...point(p.x, p.z)) : ctx.moveTo(...point(p.x, p.z)),
    );
    ctx.stroke();
  };
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  if (zoom >= MAP_TIERS.sites) {
    ctx.setLineDash([]);
    ctx.strokeStyle = '#5c4a2ecc';
    ctx.lineWidth = 7;
    trace();
    ctx.strokeStyle = '#e6d3a6dd';
    ctx.lineWidth = 3;
    trace();
    return;
  }
  ctx.strokeStyle = '#d3c19b88';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 4]);
  trace();
  ctx.setLineDash([]);
}
/** The shared player arrow on a canvas: the SVG path, or its points where `Path2D` is missing. */
let arrowPath: Path2D | null = null;
export function drawMapArrow(ctx, x: number, y: number, facing: number, size = 16) {
  const scale = size / MAP_ARROW_SIZE;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(markerRotation(facing));
  ctx.scale(scale, scale);
  ctx.translate(-MAP_ARROW_SIZE / 2, -MAP_ARROW_SIZE / 2);
  if (typeof Path2D !== 'undefined') arrowPath ??= new Path2D(MAP_ARROW_PATH);
  if (!arrowPath) {
    ctx.beginPath();
    MAP_ARROW_POINTS.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
    ctx.closePath();
  }
  ctx.fillStyle = '#fff8da';
  ctx.strokeStyle = '#12242b';
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  if (arrowPath) {
    ctx.stroke(arrowPath);
    ctx.fill(arrowPath);
  } else {
    ctx.stroke();
    ctx.fill();
  }
  ctx.restore();
}
export function mapProjection(canvas, big, self = { x: 50, z: 50 }) {
  const bounds = ATLAS_BOUNDS;
  const scale = big
    ? Math.min((canvas.width - 64) / bounds.width, (canvas.height - 80) / bounds.depth) * mapZoom
    : canvas.width / 180;
  const cx = big ? (mapCenter ? mapCenter.x : (bounds.minX + bounds.maxX) / 2) : self.x,
    cz = big ? (mapCenter ? mapCenter.z : (bounds.minZ + bounds.maxZ) / 2) : self.z;
  const point = (x, z): [number, number] => [
    canvas.width / 2 + (x - cx) * scale,
    canvas.height / 2 + (z - cz) * scale,
  ];
  return {
    scale,
    full: big,
    zoom: big ? mapZoom : 1,
    center: { x: cx, z: cz },
    point,
    world: (x, y) => ({
      x: worldClamp(cx + (x - canvas.width / 2) / scale, 'x'),
      z: worldClamp(cz + (y - canvas.height / 2) / scale, 'z'),
    }),
  };
}
const RESPAWN_MS = {
  [ENEMY_RULES.modelKey]: ENEMY_RULES.respawnMs,
  [BEHEMOTH.modelKey]: BEHEMOTH.respawnMs,
  [SABERTOOTH.modelKey]: SABERTOOTH.respawnMs,
};
const ENEMY_COLORS = {
  [BEHEMOTH.modelKey]: '#e29cff',
  [SABERTOOTH.modelKey]: '#ffb066',
};
/** Seconds until a respawning creature returns, or null when the client cannot tell. */
function respawnSeconds(creature, respawnMs, now) {
  const total = creature.respawnMs ?? respawnMs;
  if (!Number.isFinite(creature.phaseStartedAt) || !Number.isFinite(total) || !Number.isFinite(now))
    return null;
  return Math.max(0, Math.ceil((creature.phaseStartedAt + total - now) / 1000));
}
export function drawWorldMap(canvas, state, selfId, big = false) {
  const ctx = canvas.getContext('2d'),
    w = canvas.width,
    h = canvas.height,
    self = state.players.find((p) => p.id === selfId) ?? { x: 50, z: 50 };
  const { point, scale, zoom, center } = mapProjection(canvas, big, self);
  // The minimap keeps every detail; the atlas reveals detail by zoom tier.
  const mini = !big;
  const places = big && zoom >= MAP_TIERS.places;
  const near = mini || zoom >= MAP_TIERS.fires;
  const sites = mini || zoom >= MAP_TIERS.sites;
  const labels: { priority: number; rect: LabelRect; draw: () => void }[] = [];
  const label = (
    priority: number,
    text: string,
    x: number,
    y: number,
    style: { color: string; font?: string; align?: CanvasTextAlign },
  ) => {
    ctx.font = style.font ?? '12px sans-serif';
    const width = ctx.measureText(text).width,
      height = parseInt(ctx.font, 10) || 12,
      left = style.align === 'center' ? x - width / 2 : x;
    labels.push({
      priority,
      rect: { x: left, y: y - height, width, height: height + 2 },
      draw: () => {
        ctx.font = style.font ?? '12px sans-serif';
        ctx.textAlign = style.align ?? 'start';
        ctx.fillStyle = style.color;
        ctx.strokeStyle = '#10212a';
        ctx.lineWidth = 3;
        ctx.lineJoin = 'round';
        ctx.strokeText(text, x, y);
        ctx.fillText(text, x, y);
        ctx.textAlign = 'start';
      },
    });
  };
  ctx.fillStyle = big ? '#112d34' : '#193948';
  ctx.fillRect(0, 0, w, h);
  if (big) {
    // Terrain for this viewport only, at screen resolution: zooming reveals detail, never pixels.
    ctx.drawImage(atlasTerrain(canvas, { scale, center }), 0, 0, w, h);
    if (worldMapTerrainSample() === TERRAIN.coarse) scheduleRefine(canvas);
    withMapTransform(ctx, { scale, center }, w, h, () => strokeCoastline(ctx, scale, zoom));
  } else {
    const [left, top] = point(WORLD.minX, WORLD.minZ);
    ctx.drawImage(baseMap(), left, top, WORLD.width * scale, WORLD.depth * scale);
  }
  if (big) {
    ctx.strokeStyle = '#c2d0c51a';
    ctx.lineWidth = 1;
    for (let lon = -150; lon <= 150; lon += 30) {
      const a = geoToWorld(lon, 90),
        b = geoToWorld(lon, -90);
      ctx.beginPath();
      ctx.moveTo(...point(a.x, a.z));
      ctx.lineTo(...point(b.x, b.z));
      ctx.stroke();
    }
    for (let lat = -60; lat <= 60; lat += 30) {
      const a = geoToWorld(-180, lat),
        b = geoToWorld(180, lat);
      ctx.beginPath();
      ctx.moveTo(...point(a.x, a.z));
      ctx.lineTo(...point(b.x, b.z));
      ctx.stroke();
    }
    ctx.font = '500 15px sans-serif';
    ctx.textAlign = 'center';
    ctx.shadowColor = '#10212a';
    ctx.shadowBlur = 4;
    for (const item of CONTINENT_LABELS) {
      const [x, y] = point(item.x, item.z);
      ctx.fillStyle = '#ede1bcaa';
      ctx.strokeStyle = '#18313a';
      ctx.lineWidth = 4;
      ctx.strokeText(item.name, x, y);
      ctx.fillText(item.name, x, y);
    }
    ctx.shadowBlur = 0;
    ctx.textAlign = 'start';
    for (const [name, lon, lat] of [
      ['太平洋', -147, 0],
      ['大西洋', -30, 1],
      ['インド洋', 80, -22],
    ]) {
      const p = geoToWorld(lon, lat);
      ctx.fillStyle = '#b0cbd2a0';
      ctx.font = '13px sans-serif';
      ctx.fillText(name, ...point(p.x, p.z));
    }
  }
  const dot = (x, z, color, r = 3) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(...point(x, z), r, 0, Math.PI * 2);
    ctx.fill();
  };
  const ring = (x, z, color, r = 5) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(...point(x, z), r, 0, Math.PI * 2);
    ctx.stroke();
  };
  if (big) {
    ctx.save();
    strokeGulfSpine(ctx, point, zoom);
    if (places)
      label(2, `${GULF.name}（創作）`, ...point(MANY_HEARTHS.x - 160, GULF.minZ - 25), {
        color: '#ead5a5',
      });
    ctx.restore();
  }
  ctx.save();
  ctx.font = '12px sans-serif';
  for (const s of SETTLEMENTS) {
    const color = COUNTRIES.find((c) => c.id === s.id)?.color ?? '#ffdc8d';
    dot(s.x, s.z, color, near ? 5 : 4);
    if (near) label(3, s.name, ...point(s.x + 6, s.z - 7), { color });
  }
  if (sites) {
    for (const s of GULF_STOPS) {
      dot(s.x, s.z, '#e8c879', 3);
      label(3, s.name, ...point(s.x + 7, s.z - 5), { color: '#ead9af' });
    }
    for (const p of GULF_LANDMARKS)
      dot(p.x, p.z, '#81786a', Math.max(2, p.clearance * scale * 0.6));
    for (const p of OBSIDIAN_OUTCROPS) dot(p.x, p.z, '#dcb8e2', 2);
    for (const p of SPRINGS) dot(p.x, p.z, '#8ed7df', 3);
    for (const p of FARM_PLOTS) dot(p.x, p.z, '#c6c081', 1.5);
    for (const s of FISHING_SITES) {
      dot(s.x, s.z, '#8be0d7', 4);
      if (s.boatOnly) label(3, s.name, ...point(s.x + 6, s.z - 7), { color: '#8be0d7' });
    }
    for (const l of LANDINGS) {
      dot(l.x, l.z, '#aacddd', 3);
      label(3, l.name, ...point(l.x + 4, l.z + 10), { color: '#aacddd' });
    }
    for (const s of SHELL_BEDS) {
      dot(s.x, s.z, '#f2dfbc', 4);
      label(3, '貝場', ...point(s.x + 5, s.z - 10), { color: '#f2dfbc' });
    }
    for (const [siteList, color, text] of [
      [MIDDEN_SITES, '#e3d0ad', '貝塚'],
      [KNAPPING_SITES, '#c8a8df', '石器作業場'],
    ] as const) {
      for (const s of siteList) {
        dot(s.x, s.z, color, 3);
        label(3, text, ...point(s.x + 4, s.z + 4), { color });
      }
    }
  }
  ctx.restore();
  if (big && sites) {
    ctx.save();
    ctx.font = '12px sans-serif';
    let travelling = 0;
    for (const d of HOUSEHOLDS) {
      const hh = state.households?.find((item) => item.id === d.id);
      if (!hh || hh.stage === 'home') continue;
      const members = (state.residents ?? []).filter((r) => d.members.includes(r.id));
      if (!members.length) continue;
      const middle = {
        x: members.reduce((n, r) => n + r.x, 0) / members.length,
        z: members.reduce((n, r) => n + r.z, 0) / members.length,
      };
      const color = COUNTRIES.find((c) => c.id === d.homeId)?.color ?? '#ffdc8d';
      if (hh.stage !== 'visiting') {
        travelling++;
        ctx.strokeStyle = color;
        ctx.setLineDash([3, 5]);
        ctx.beginPath();
        ctx.moveTo(...point(middle.x, middle.z));
        const remaining =
          hh.stage === 'returning' ? d.route.slice(0, hh.leg + 1).reverse() : d.route.slice(hh.leg);
        for (const p of remaining) ctx.lineTo(...point(p.x, p.z));
        ctx.stroke();
        ctx.setLineDash([]);
      }
      for (const r of members) dot(r.x, r.z, color, 3);
      const text =
        d.name +
        (hh.stage === 'returning' ? ' → 国へ' : hh.stage === 'visiting' ? ' · 滞在' : ' → 集い場');
      const [labelX, labelY] = point(middle.x + 8, middle.z);
      label(3, text, labelX, labelY + 18, { color: '#f2e4bd' });
    }
    canvas.dataset.travellingHouseholds = String(travelling);
    ctx.restore();
  }
  if (big && near && state.maritime && inGulf(center.x, center.z)) {
    ctx.save();
    ctx.strokeStyle = '#94e1e6';
    ctx.lineWidth = 2;
    for (const z of [650, 850, 1050, 1250])
      for (const x of [-2420, -2210, -2000]) {
        const flow = seaConditions(state.maritime, x, z);
        const length = Math.hypot(flow.currentX, flow.currentZ);
        if (length < 0.04 || coastDistance(x, z) > -6) continue;
        const [px, py] = point(x, z),
          size = 7 + 9 * flow.exposure;
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(Math.atan2(flow.currentZ, flow.currentX));
        ctx.beginPath();
        ctx.moveTo(-size / 2, 0);
        ctx.lineTo(size / 2, 0);
        ctx.moveTo(size / 2 - 4, -4);
        ctx.lineTo(size / 2, 0);
        ctx.lineTo(size / 2 - 4, 4);
        ctx.stroke();
        ctx.restore();
      }
    ctx.fillStyle = '#bcebef';
    ctx.font = '12px sans-serif';
    ctx.fillText(
      `${SEA_WEATHER[state.maritime.kind].name} · ${currentDirection(state.maritime)} · 矢印に沿うと速く進む`,
      10,
      36,
    );
    ctx.restore();
  }
  if (big && selection) {
    const [x, y] = point(selection.x, selection.z);
    ctx.strokeStyle = '#ffda88';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 11, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (near)
    for (const item of LANDMARKS) {
      const [x, y] = point(item.x, item.z),
        r = 4;
      ctx.beginPath();
      ctx.moveTo(x, y - r);
      ctx.lineTo(x - r, y + r);
      ctx.lineTo(x + r, y + r);
      ctx.closePath();
      ctx.fillStyle = item.key === 'volcanic-cone' ? '#f19c73' : '#caf1f2';
      ctx.fill();
    }
  if (places)
    for (const stop of EXPEDITION_STOPS) {
      const [x, y] = point(stop.x, stop.z);
      ctx.strokeStyle = '#ffe2a4';
      ctx.lineWidth = 1.4;
      ctx.strokeRect(x - 3, y - 3, 6, 6);
      // The fire of the same name takes over the label from 4× on.
      if (!near) label(2, stop.name, x + 8, y + 4, { color: '#ffe9c0' });
    }
  if (mini || places) {
    const [x, y] = point(CASTLE.x, CASTLE.z);
    ctx.fillStyle = '#d8cebc';
    ctx.fillRect(x - 4, y - 3, 8, 7);
    ctx.fillRect(x - 5, y - 6, 3, 3);
    ctx.fillRect(x + 2, y - 6, 3, 3);
    if (places) {
      label(2, CASTLE.name, x + 8, y + 4, { color: '#e9e0cc' });
      const [gx, gy] = point(CASTLE_GATE.x, CASTLE_GATE.z);
      dot(CASTLE_GATE.x, CASTLE_GATE.z, '#d8cebc', 2.5);
      label(2, CASTLE_GATE.name, gx + 6, gy + 4, { color: '#d8cebc', font: '11px sans-serif' });
    }
  }
  if (mini || places)
    for (const region of ADVENTURE_REGIONS) {
      const [x, y] = point(region.x, region.z),
        r = Math.max(6, region.radius * scale);
      ctx.strokeStyle = region.color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.stroke();
      if (places && !near)
        label(2, region.name, x + 8, y + 4, { color: region.color, font: '11px sans-serif' });
      if (near) {
        const progress = adventureProgress(self, region.id);
        for (const c of region.checkpoints) {
          dot(c.x, c.z, progress.visited.includes(c.id) ? '#9cce9b' : '#ffe3a3', 3);
          if (big)
            label(3, c.name, ...point(c.x + 4, c.z), { color: '#fff1cf', font: '11px sans-serif' });
        }
        dot(region.camp.x, region.camp.z, '#ffb971', 4);
      }
    }
  if (near)
    for (const rift of RIFTS) {
      const [x, y] = point(rift.x, rift.z);
      ctx.fillStyle = '#b9a2ff';
      ctx.font = '17px sans-serif';
      ctx.fillText('✧', x - 6, y + 5);
      if (big) label(3, rift.name, x + 10, y + 4, { color: '#cbbcff', font: '11px sans-serif' });
    }
  if (near) {
    for (const fire of state.cookingFires ?? []) dot(fire.x, fire.z, '#efb573', big ? 3 : 2);
    dot(CAMP.x, CAMP.z, '#efb573', 4);
    dot(NPC.x, NPC.z, '#dad3a9', 3);
  }
  if (near) {
    let shown = 0;
    for (const animal of state.animals ?? []) {
      if (animal.phase === 'respawning') {
        if (big) {
          ring(animal.x, animal.z, '#b39b6a', 5);
          const seconds = respawnSeconds(animal, HUNTING.respawnMs, state.serverTime);
          label(
            1,
            seconds === null ? 'マンモス · 復活待ち' : `マンモス · 復活まで ${seconds} 秒`,
            ...point(animal.x + 8, animal.z),
            { color: '#cdb98e', font: '11px sans-serif' },
          );
        }
        continue;
      }
      dot(animal.x, animal.z, animal.phase === 'meat' ? '#e5b6a9' : '#d9c089', 3);
      if (big && !shown++)
        label(1, 'マンモス', ...point(animal.x + 6, animal.z - 6), { color: '#e6d3a4' });
    }
  }
  if (near)
    for (const boat of state.boats ?? []) {
      const [x, y] = point(boat.x, boat.z);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(-boat.facing);
      ctx.fillStyle = boat.riderId ? '#ffde96' : '#bcdddc';
      ctx.fillRect(-2, -5, 4, 10);
      ctx.restore();
    }
  if (near) {
    // The marsh floor is drawn ground; the territory ring needs the living enemy.
    const [x, y] = point(BEHEMOTH_MARSH.x, BEHEMOTH_MARSH.z);
    ctx.fillStyle = '#3d4a2eb8';
    ctx.beginPath();
    ctx.arc(x, y, BEHEMOTH_MARSH.radius * scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#5b6d66';
    for (const pool of BEHEMOTH_MARSH.pools) {
      ctx.beginPath();
      ctx.arc(...point(pool.x, pool.z), Math.max(1.5, pool.radius * scale), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (near && (state.enemies ?? []).some((e) => e.modelKey === BEHEMOTH.modelKey)) {
    const [x, y] = point(BEHEMOTH_GROUND.x, BEHEMOTH_GROUND.z);
    ctx.strokeStyle = '#d193e9';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, BEHEMOTH.territoryRadius * scale, 0, Math.PI * 2);
    ctx.stroke();
    if (big) label(2, '紫尾の巨獣の沼地', x + 8, y + 4, { color: '#ebc4ff' });
  }
  if (near && (state.enemies ?? []).some((e) => e.modelKey === SABERTOOTH.modelKey)) {
    const [x, y] = point(SABERTOOTH_GROUND.x, SABERTOOTH_GROUND.z);
    ctx.strokeStyle = '#f0b25a';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, SABERTOOTH.territoryRadius * scale, 0, Math.PI * 2);
    ctx.stroke();
    if (big) label(2, '剣牙の大虎の狩り場', x + 8, y + 4, { color: '#ffd9a0' });
  }
  if (near)
    for (const enemy of state.enemies ?? []) {
      if (!enemy.hostile) continue;
      const [x, y] = point(enemy.x, enemy.z);
      if (enemy.phase === 'respawning') {
        // Home is not in the snapshot; the hollow ring marks the last known position.
        if (!big) continue;
        ring(enemy.x, enemy.z, ENEMY_COLORS[enemy.modelKey] ?? '#ff9183', 5);
        const seconds = respawnSeconds(enemy, RESPAWN_MS[enemy.modelKey], state.serverTime);
        label(
          1,
          `${enemy.name} · ${seconds === null ? '復活待ち' : `復活まで ${seconds} 秒`}`,
          x + 8,
          y + 4,
          { color: '#d8b8b2', font: '11px sans-serif' },
        );
        continue;
      }
      const alive = enemy.phase === 'alive';
      const color = alive ? (ENEMY_COLORS[enemy.modelKey] ?? '#ff9183') : '#926d6a';
      dot(enemy.x, enemy.z, color, big ? (alive ? 4 : 3) : 3);
      if (big && alive) {
        ctx.strokeStyle = '#ff5b4b';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x - 6, y - 6);
        ctx.lineTo(x + 6, y + 6);
        ctx.moveTo(x + 6, y - 6);
        ctx.lineTo(x - 6, y + 6);
        ctx.stroke();
      }
      if (big)
        label(1, sites ? enemyStatusLabel(enemy) : enemy.name, x + 8, y + 4, {
          color: alive ? '#ffb8ad' : '#c9a9a4',
        });
    }
  fireLabelIds = new Set<string>();
  if (big && near) {
    // Fire names are DOM labels; reserve their space first so canvas names give way.
    for (const fire of WARP_POINTS) {
      const [x, y] = point(fire.x, fire.z);
      if (x < -60 || y < -60 || x > w + 60 || y > h + 60) continue;
      const width = Math.min(180, fire.name.length * 12 + 16);
      labels.push({
        priority: 0,
        rect: { x: x - width / 2, y: y + 22, width, height: 18 },
        draw: () => fireLabelIds.add(fire.id),
      });
    }
  }
  for (const item of placeLabels(labels)) item.draw();
  for (const player of state.players) {
    if (big && player.id === selfId) continue; // The atlas uses a high-contrast DOM arrow above its fire markers.
    dot(player.x, player.z, player.id === selfId ? '#fff8da' : player.color, big ? 4 : 3);
    if (player.id === selfId) {
      const [x, y] = point(player.x, player.z);
      drawMapArrow(ctx, x, y, player.facing);
      ctx.strokeStyle = '#fff8daaa';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x, y, 7, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  const pins = (state.mapPins ?? []).filter((pin) => pin.expiresAt > state.serverTime);
  for (const pin of pins) {
    let [x, y] = point(pin.x, pin.z);
    if (big && (x < 10 || y < 10 || x > w - 10 || y > h - 10)) continue;
    ctx.save();
    if (!big) {
      // Keep distant invitations on the minimap edge, in the actual direction of travel.
      const dx = x - w / 2,
        dy = y - h / 2;
      const ratio = Math.max(1, Math.abs(dx) / (w / 2 - 12), Math.abs(dy) / (h / 2 - 26));
      x = w / 2 + dx / ratio;
      y = h / 2 + dy / ratio;
    }
    ctx.strokeStyle = '#10252a';
    ctx.fillStyle = pin.color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x, y - 9);
    ctx.lineTo(x + 7, y - 2);
    ctx.lineTo(x, y + 7);
    ctx.lineTo(x - 7, y - 2);
    ctx.closePath();
    ctx.stroke();
    ctx.fill();
    if (big) {
      const text = `${pin.name}：ここへ行こう`;
      ctx.font = '600 12px sans-serif';
      ctx.textAlign = 'center';
      const half = ctx.measureText(text).width / 2 + 4;
      const labelX = Math.max(half, Math.min(w - half, x));
      ctx.strokeText(text, labelX, y + 23);
      ctx.fillText(text, labelX, y + 23);
    }
    ctx.restore();
  }
  canvas.dataset.mapPinCount = String(pins.length);
  ctx.fillStyle = '#fff0d3';
  ctx.font = big ? '12px sans-serif' : '10px sans-serif';
  if (!big)
    ctx.fillText(
      inGulf(self.x, self.z)
        ? GULF.name
        : (regionAt(self.x, self.z)?.name ?? biomeAt(self.x, self.z).short),
      10,
      18,
    );
  const metres = big
      ? ([10, 25, 50, 100, 200, 500, 1000].filter((m) => m * scale < w / 5).at(-1) ?? 10)
      : 25,
    pixels = metres * scale;
  ctx.fillRect(w - pixels - 12, h - 12, pixels, 1);
  ctx.textAlign = 'right';
  ctx.fillText(`${metres} m`, w - 12, h - 18);
  ctx.textAlign = 'start';
  canvas.dataset.mapMode = big ? 'atlas' : 'local';
  canvas.dataset.mapZoom = big ? zoom.toFixed(2) : '1';
  canvas.dataset.seaWeather = state.maritime?.kind ?? '';
  canvas.dataset.worldWidth = String(WORLD.width);
  canvas.dataset.worldDepth = String(WORLD.depth);
  if (big) canvas.dispatchEvent(new Event('mapdraw'));
}
