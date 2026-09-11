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
  geoToWorld,
} from '../shared/paleo-geography.mjs';
import { LANDMARKS } from '../shared/landmarks.mjs';
import { CASTLE } from '../shared/castle-layout.mjs';
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
  atlasBackground,
  overview = true,
  gulfView = false,
  selection = null;
let mapZoom = 1,
  mapCenter = null,
  mapDetails = false;
export function setWorldMapDetails(value) {
  mapDetails = value;
}
export function centerWorldMap(point) {
  mapCenter = { x: point.x, z: point.z };
}
export function zoomWorldMap(
  canvas,
  self,
  factor,
  anchor = { x: canvas.width / 2, y: canvas.height / 2 },
) {
  const before = mapProjection(canvas, true, self);
  const world = before.world(anchor.x, anchor.y);
  mapZoom = Math.max(1, Math.min(32, mapZoom * factor));
  const after = mapProjection(canvas, true, self);
  mapCenter = {
    x: worldClamp(world.x - (anchor.x - canvas.width / 2) / after.scale, 'x'),
    z: worldClamp(world.z - (anchor.y - canvas.height / 2) / after.scale, 'z'),
  };
}
export function panWorldMap(canvas, self, dx, dy) {
  const projection = mapProjection(canvas, true, self);
  const center = projection.world(canvas.width / 2 - dx, canvas.height / 2 - dy);
  centerWorldMap(center);
}
export function setWorldMapSelection(point) {
  selection = point;
}
export function setWorldMapMode(mode) {
  overview = mode !== 'local';
  gulfView = mode === 'gulf';
  mapZoom = 1;
  mapCenter = null;
}
function baseMap(atlas = false) {
  if (background) return atlas ? atlasBackground : background;
  const width = 2048,
    height = 1024,
    canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d'),
    pixels = ctx.createImageData(width, height),
    landMask = new Uint8Array(width * height),
    colors = BIOMES.map((b) =>
      b.color
        .slice(1)
        .match(/../g)
        .map((n) => parseInt(n, 16)),
    );
  for (let z = 0; z < height; z++)
    for (let x = 0; x < width; x++) {
      const wx = WORLD.minX + ((x + 0.5) / width) * WORLD.width,
        wz = WORLD.minZ + ((z + 0.5) / height) * WORLD.depth,
        d = coastDistance(wx, wz),
        i = (z * width + x) * 4;
      if (d > 0) {
        landMask[z * width + x] = 1;
        const weights = biomeWeights(wx, wz);
        for (let c = 0; c < 3; c++)
          pixels.data[i + c] =
            weights.reduce((sum, w, j) => sum + w * colors[j][c], 0) * (0.78 + Math.min(d, 6) / 60);
      } else {
        const coast = Math.max(0, 1 + d / 16);
        pixels.data[i] = 25 + coast * 24;
        pixels.data[i + 1] = 57 + coast * 31;
        pixels.data[i + 2] = 72 + coast * 30;
      }
      pixels.data[i + 3] = 255;
    }
  ctx.putImageData(pixels, 0, 0);
  background = canvas;
  // A quieter printed-map palette and a crisp shoreline make travel icons readable.
  // The geography is identical to the minimap; no invented terrain is added.
  atlasBackground = document.createElement('canvas');
  atlasBackground.width = width;
  atlasBackground.height = height;
  for (let i = 0; i < landMask.length; i++) {
    const k = i * 4;
    if (landMask[i]) {
      const shore =
        i % width > 0 &&
        i % width < width - 1 &&
        (!landMask[i - 1] ||
          !landMask[i + 1] ||
          (i >= width && !landMask[i - width]) ||
          (i < landMask.length - width && !landMask[i + width]));
      for (let c = 0; c < 3; c++)
        pixels.data[k + c] = shore
          ? [170, 175, 137][c]
          : pixels.data[k + c] * 0.66 + [35, 37, 22][c];
    } else {
      pixels.data[k] = 17 + (pixels.data[k] - 25) * 0.5;
      pixels.data[k + 1] = 45 + (pixels.data[k + 1] - 57) * 0.65;
      pixels.data[k + 2] = 52 + (pixels.data[k + 2] - 72) * 0.6;
    }
  }
  atlasBackground.getContext('2d').putImageData(pixels, 0, 0);
  return atlas ? atlasBackground : canvas;
}
export function mapProjection(canvas, big, self = { x: 50, z: 50 }) {
  const full = big && overview;
  const bounds = gulfView
    ? { ...GULF, width: GULF.maxX - GULF.minX, depth: GULF.maxZ - GULF.minZ }
    : {
        minX: Math.min(EARTH.minX, GULF.minX),
        maxX: Math.max(EARTH.maxX, GULF.maxX),
        minZ: Math.min(EARTH.minZ, GULF.minZ),
        maxZ: Math.max(EARTH.maxZ, GULF.maxZ),
        width: Math.max(EARTH.maxX, GULF.maxX) - Math.min(EARTH.minX, GULF.minX),
        depth: Math.max(EARTH.maxZ, GULF.maxZ) - Math.min(EARTH.minZ, GULF.minZ),
      };
  const scale =
    (full
      ? Math.min((canvas.width - 64) / bounds.width, (canvas.height - 80) / bounds.depth)
      : big
        ? Math.min(canvas.width, canvas.height) / 440
        : canvas.width / 180) * (big ? mapZoom : 1);
  const cx = big && mapCenter ? mapCenter.x : full ? (bounds.minX + bounds.maxX) / 2 : self.x,
    cz = big && mapCenter ? mapCenter.z : full ? (bounds.minZ + bounds.maxZ) / 2 : self.z;
  const point = (x, z) => [
    canvas.width / 2 + (x - cx) * scale,
    canvas.height / 2 + (z - cz) * scale,
  ];
  return {
    scale,
    full,
    zoom: big ? mapZoom : 1,
    point,
    world: (x, y) => ({
      x: worldClamp(cx + (x - canvas.width / 2) / scale, 'x'),
      z: worldClamp(cz + (y - canvas.height / 2) / scale, 'z'),
    }),
  };
}
export function drawWorldMap(canvas, state, selfId, big = false) {
  const ctx = canvas.getContext('2d'),
    w = canvas.width,
    h = canvas.height,
    self = state.players.find((p) => p.id === selfId) ?? { x: 50, z: 50 };
  const { point, scale, full } = mapProjection(canvas, big, self);
  const detailed = !big || mapDetails;
  ctx.fillStyle = big ? '#112d34' : '#193948';
  ctx.fillRect(0, 0, w, h);
  const [left, top] = point(WORLD.minX, WORLD.minZ);
  ctx.drawImage(baseMap(big), left, top, WORLD.width * scale, WORLD.depth * scale);
  if (full && !gulfView) {
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
    for (const label of CONTINENT_LABELS) {
      const [x, y] = point(label.x, label.z);
      ctx.fillStyle = '#ede1bcaa';
      ctx.strokeStyle = '#18313a';
      ctx.lineWidth = 4;
      ctx.strokeText(label.name, x, y);
      ctx.fillText(label.name, x, y);
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
  if (big) {
    ctx.save();
    ctx.strokeStyle = '#d3c19b88';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    GULF_SPINE.forEach((p, i) =>
      i ? ctx.lineTo(...point(p.x, p.z)) : ctx.moveTo(...point(p.x, p.z)),
    );
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = '12px sans-serif';
    ctx.fillStyle = '#ead5a5';
    if (full) ctx.fillText(`${GULF.name}（創作）`, ...point(MANY_HEARTHS.x - 160, GULF.minZ - 25));
    for (const s of SETTLEMENTS) {
      const color = COUNTRIES.find((c) => c.id === s.id)?.color ?? '#ffdc8d';
      dot(s.x, s.z, color, full ? 4 : 5);
      if (detailed && (!full || gulfView)) {
        ctx.fillStyle = color;
        ctx.fillText(s.name, ...point(s.x + 6, s.z - 7));
      }
    }
    if (detailed && (!full || gulfView)) {
      for (const s of GULF_STOPS) {
        dot(s.x, s.z, '#e8c879', 3);
        ctx.fillStyle = '#ead9af';
        ctx.fillText(s.name, ...point(s.x + 7, s.z - 5));
      }
      for (const p of GULF_LANDMARKS)
        dot(p.x, p.z, '#81786a', Math.max(2, p.clearance * scale * 0.6));
      for (const p of OBSIDIAN_OUTCROPS) dot(p.x, p.z, '#dcb8e2', 2);
      for (const p of SPRINGS) dot(p.x, p.z, '#8ed7df', 3);
      for (const p of FARM_PLOTS) dot(p.x, p.z, '#c6c081', 1.5);
      for (const s of FISHING_SITES) {
        dot(s.x, s.z, '#8be0d7', 4);
        if (s.boatOnly) {
          ctx.fillStyle = '#8be0d7';
          ctx.fillText(s.name, ...point(s.x + 6, s.z - 7));
        }
      }
      for (const l of LANDINGS) {
        dot(l.x, l.z, '#aacddd', 3);
        ctx.fillStyle = '#aacddd';
        ctx.fillText(l.name, ...point(l.x + 4, l.z + 10));
      }
      for (const s of SHELL_BEDS) {
        dot(s.x, s.z, '#f2dfbc', 4);
        ctx.fillStyle = '#f2dfbc';
        ctx.fillText('貝場', ...point(s.x + 5, s.z - 10));
      }
      if (!full)
        for (const [sites, color, label] of [
          [MIDDEN_SITES, '#e3d0ad', '貝塚'],
          [KNAPPING_SITES, '#c8a8df', '石器作業場'],
        ] as const) {
          for (const s of sites) {
            dot(s.x, s.z, color, 3);
            ctx.fillStyle = color;
            ctx.fillText(label, ...point(s.x + 4, s.z + 4));
          }
        }
    }
    ctx.restore();
  }
  if (big && detailed && (!full || gulfView)) {
    ctx.save();
    ctx.font = '12px sans-serif';
    let travelling = 0;
    for (const d of HOUSEHOLDS) {
      const h = state.households?.find((h) => h.id === d.id);
      if (!h || h.stage === 'home') continue;
      const members = (state.residents ?? []).filter((r) => d.members.includes(r.id));
      if (!members.length) continue;
      const center = {
        x: members.reduce((n, r) => n + r.x, 0) / members.length,
        z: members.reduce((n, r) => n + r.z, 0) / members.length,
      };
      const color = COUNTRIES.find((c) => c.id === d.homeId)?.color ?? '#ffdc8d';
      if (h.stage !== 'visiting') {
        travelling++;
        ctx.strokeStyle = color;
        ctx.setLineDash([3, 5]);
        ctx.beginPath();
        ctx.moveTo(...point(center.x, center.z));
        const remaining =
          h.stage === 'returning' ? d.route.slice(0, h.leg + 1).reverse() : d.route.slice(h.leg);
        for (const p of remaining) ctx.lineTo(...point(p.x, p.z));
        ctx.stroke();
        ctx.setLineDash([]);
      }
      for (const r of members) dot(r.x, r.z, color, 3);
      const label =
        d.name +
        (h.stage === 'returning' ? ' → 国へ' : h.stage === 'visiting' ? ' · 滞在' : ' → 集い場');
      const [labelX, labelY] = point(center.x + 8, center.z);
      ctx.fillStyle = '#f2e4bd';
      ctx.strokeStyle = '#142820';
      ctx.lineWidth = 3;
      ctx.lineJoin = 'round';
      ctx.strokeText(label, labelX, labelY + 18);
      ctx.fillText(label, labelX, labelY + 18);
    }
    canvas.dataset.travellingHouseholds = String(travelling);
    ctx.restore();
  }
  if (big && detailed && gulfView && full && state.maritime) {
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
  if (detailed)
    for (const item of LANDMARKS) {
      const [x, y] = point(item.x, item.z),
        r = full ? 3 : 4;
      ctx.beginPath();
      ctx.moveTo(x, y - r);
      ctx.lineTo(x - r, y + r);
      ctx.lineTo(x + r, y + r);
      ctx.closePath();
      ctx.fillStyle = item.key === 'volcanic-cone' ? '#f19c73' : '#caf1f2';
      ctx.fill();
    }
  if (big && detailed)
    for (const stop of EXPEDITION_STOPS) {
      const [x, y] = point(stop.x, stop.z);
      ctx.strokeStyle = '#ffe2a4';
      ctx.lineWidth = 1.4;
      ctx.strokeRect(x - 3, y - 3, 6, 6);
    }
  if (detailed) {
    const [x, y] = point(CASTLE.x, CASTLE.z);
    ctx.fillStyle = '#d8cebc';
    ctx.fillRect(x - 4, y - 3, 8, 7);
    ctx.fillRect(x - 5, y - 6, 3, 3);
    ctx.fillRect(x + 2, y - 6, 3, 3);
    if (big && !full) {
      ctx.font = '12px sans-serif';
      ctx.fillText(CASTLE.name, x + 8, y + 4);
    }
  }
  if (detailed)
    for (const region of ADVENTURE_REGIONS) {
      const [x, y] = point(region.x, region.z),
        r = full ? 6 : region.radius * scale;
      ctx.strokeStyle = region.color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.stroke();
      if (big && full) {
        ctx.font = '11px sans-serif';
        ctx.fillStyle = region.color;
        ctx.fillText(region.kind, x + 8, y + 4);
      }
      if (!full) {
        const progress = adventureProgress(self, region.id);
        for (const c of region.checkpoints) {
          dot(c.x, c.z, progress.visited.includes(c.id) ? '#9cce9b' : '#ffe3a3', 3);
          if (big) {
            ctx.fillStyle = '#fff1cf';
            ctx.font = '11px sans-serif';
            ctx.fillText(c.name, ...point(c.x + 4, c.z));
          }
        }
        dot(region.camp.x, region.camp.z, '#ffb971', 4);
      }
    }
  if (!full && detailed)
    for (const rift of RIFTS) {
      const [x, y] = point(rift.x, rift.z);
      ctx.fillStyle = '#b9a2ff';
      ctx.font = '17px sans-serif';
      ctx.fillText('✧', x - 6, y + 5);
    }
  if (!full && detailed) {
    for (const fire of state.cookingFires ?? []) dot(fire.x, fire.z, '#efb573', big ? 3 : 2);
    dot(CAMP.x, CAMP.z, '#efb573', 4);
    dot(NPC.x, NPC.z, '#dad3a9', 3);
  }
  if (detailed)
    for (const animal of state.animals ?? [])
      if (animal.phase !== 'respawning')
        dot(animal.x, animal.z, animal.phase === 'meat' ? '#e5b6a9' : '#d9c089', full ? 2 : 3);
  if (detailed)
    for (const boat of state.boats ?? []) {
      const [x, y] = point(boat.x, boat.z);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(-boat.facing);
      ctx.fillStyle = boat.riderId ? '#ffde96' : '#bcdddc';
      ctx.fillRect(-2, -5, 4, 10);
      ctx.restore();
    }
  if (detailed && !full) {
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
  if (detailed && !full && (state.enemies ?? []).some((e) => e.modelKey === BEHEMOTH.modelKey)) {
    const [x, y] = point(BEHEMOTH_GROUND.x, BEHEMOTH_GROUND.z);
    ctx.strokeStyle = '#d193e9';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, BEHEMOTH.territoryRadius * scale, 0, Math.PI * 2);
    ctx.stroke();
    if (big) {
      ctx.font = '12px sans-serif';
      ctx.fillStyle = '#ebc4ff';
      ctx.fillText('紫尾の巨獣の沼地', x + 8, y + 4);
    }
  }
  if (detailed && !full && (state.enemies ?? []).some((e) => e.modelKey === SABERTOOTH.modelKey)) {
    const [x, y] = point(SABERTOOTH_GROUND.x, SABERTOOTH_GROUND.z);
    ctx.strokeStyle = '#f0b25a';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, SABERTOOTH.territoryRadius * scale, 0, Math.PI * 2);
    ctx.stroke();
    if (big) {
      ctx.font = '12px sans-serif';
      ctx.fillStyle = '#ffd9a0';
      ctx.fillText('剣牙の大虎の狩り場', x + 8, y + 4);
    }
  }
  if (detailed)
    for (const enemy of state.enemies ?? [])
      if (enemy.hostile && enemy.phase !== 'respawning')
        dot(enemy.x, enemy.z, enemy.phase === 'alive' ? '#ff9183' : '#926d6a', full ? 2 : 3);
  for (const player of state.players) {
    if (big && player.id === selfId) continue; // The atlas uses a high-contrast DOM arrow above its fire markers.
    dot(player.x, player.z, player.id === selfId ? '#fff8da' : player.color, big ? 4 : 3);
    if (player.id === selfId) {
      const [x, y] = point(player.x, player.z);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(-player.facing);
      ctx.beginPath();
      ctx.moveTo(0, 10);
      ctx.lineTo(-3, 3);
      ctx.lineTo(3, 3);
      ctx.fillStyle = '#fff8da';
      ctx.fill();
      ctx.restore();
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
      const label = `${pin.name}：ここへ行こう`;
      ctx.font = '600 12px sans-serif';
      ctx.textAlign = 'center';
      const half = ctx.measureText(label).width / 2 + 4;
      const labelX = Math.max(half, Math.min(w - half, x));
      ctx.strokeText(label, labelX, y + 23);
      ctx.fillText(label, labelX, y + 23);
    }
    ctx.restore();
  }
  canvas.dataset.mapPinCount = String(pins.length);
  ctx.fillStyle = '#fff0d3';
  ctx.font = big ? '12px sans-serif' : '10px sans-serif';
  if (!big)
    ctx.fillText(
      full
        ? gulfView
          ? '三つの岸 · 六つの休み場 · 1,480 × 1,340 m'
          : '炎マーク：焚き火ワープ · ○ 探索地域'
        : inGulf(self.x, self.z)
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
  canvas.dataset.mapMode = full ? (gulfView ? 'gulf' : 'earth') : 'local';
  canvas.dataset.seaWeather = state.maritime?.kind ?? '';
  canvas.dataset.worldWidth = String(WORLD.width);
  canvas.dataset.worldDepth = String(WORLD.depth);
  if (big) canvas.dispatchEvent(new Event('mapdraw'));
}
