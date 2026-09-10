import type { Obstacle, Point } from './types.mjs';
import { SCENERY, BRIDGE } from './scenery-layout.mjs';
import { CASTLE_SURFACE } from './castle-surface.mjs';
import { CASTLE_GATE, castleWorld } from './castle-layout.mjs';
import { MODEL_BOUNDS } from './model-bounds.mjs';
import { LANDMARKS } from './landmarks.mjs';
import { LANDMARK_BOUNDS } from './landmark-bounds.mjs';
import { landmarkObstacles } from './landmark-collision.mjs';
import { REGION_FEATURES } from './region-features.mjs';
import { REGION_FEATURE_BOUNDS } from './region-feature-bounds.mjs';
import { ADVENTURE_LANDMARKS } from './adventure-layout.mjs';
import { GULF_LANDMARKS } from './gulf-region.mjs';
import { COASTAL, MIDDEN_SITES, KNAPPING_SITES } from './coastal-sites.mjs';
import { WORLD, worldClamp, INITIAL_RESOURCES, NPC } from './world.mjs';
import { riverX, riverHalfWidth, terrainHeight } from './terrain.mjs';
import { resourceAppearance } from './biome-scenery.mjs';
import { landBodyFree, isLand, landmassAt } from './paleo-geography.mjs';

const CELL = 4,
  EPS = 0.0001;
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
function modelBox(item) {
  const source = MODEL_BOUNDS[item.key],
    bounds = item.key === 'valley-pine' ? source.trunk : source;
  const [sx, sy, sz] = Array.isArray(item.scale)
    ? item.scale
    : [item.scale, item.scale, item.scale];
  const c = Math.cos(item.yaw),
    s = Math.sin(item.yaw),
    cx = (bounds.min[0] + bounds.max[0]) * 0.5 * sx,
    cz = (bounds.min[2] + bounds.max[2]) * 0.5 * sz;
  return {
    id: item.id || item.key,
    resourceId: item.resourceId,
    type: 'box',
    x: item.x + c * cx + s * cz,
    z: item.z - s * cx + c * cz,
    hx: (bounds.max[0] - bounds.min[0]) * 0.5 * sx,
    hz: (bounds.max[2] - bounds.min[2]) * 0.5 * sz,
    c,
    s,
    height: source.max[1] * sy,
    groundX: item.x,
    groundZ: item.z,
  };
}
export function staticObstacles(): Obstacle[] {
  const result: Obstacle[] = [
    ...SCENERY.trees,
    ...SCENERY.rocks,
    ...SCENERY.ridges,
    ...SCENERY.tents,
    ...SCENERY.props,
    ...SCENERY.fires,
  ]
    .filter((item) => item.key !== 'berry-bush')
    .map(modelBox);
  result.push(...landmarkObstacles(LANDMARKS, LANDMARK_BOUNDS));
  result.push(...landmarkObstacles(REGION_FEATURES, REGION_FEATURE_BOUNDS));
  result.push(
    ...landmarkObstacles(ADVENTURE_LANDMARKS, { ...LANDMARK_BOUNDS, ...REGION_FEATURE_BOUNDS }),
    ...landmarkObstacles(GULF_LANDMARKS, { ...LANDMARK_BOUNDS, ...REGION_FEATURE_BOUNDS }),
  );
  // The shallow oasis spring is surrounded by a walkable bank.
  result.push({ id: 'oasis-spring', type: 'circle', x: -153, z: 416, radius: 5.5, height: 0 });
  // Indexed at the largest footprint; each room activates the occupied mound's current size.
  for (const s of MIDDEN_SITES)
    result.push({
      ...s,
      middenId: s.id,
      type: 'circle',
      radius: COASTAL.middenRadius,
      height: 0.45,
      groundX: s.x,
      groundZ: s.z,
    });
  for (const s of KNAPPING_SITES)
    result.push(modelBox({ ...s, key: 'valley-boulder', scale: [0.3, 0.16, 0.3], yaw: 0 }));
  for (const resource of INITIAL_RESOURCES)
    if (resource.type !== 'berry')
      result.push(
        modelBox({
          ...resourceAppearance(resource),
          x: resource.x,
          z: resource.z,
          resourceId: resource.id,
        }),
      );
  for (const z of [BRIDGE.z + BRIDGE.minZ - 0.08, BRIDGE.z + BRIDGE.maxZ + 0.08])
    result.push({
      id: 'bridge-rail',
      type: 'box',
      x: BRIDGE.x,
      z,
      hx: 5.35,
      hz: 0.1,
      c: 1,
      s: 0,
      height: 1.1,
    });
  result.push({ id: 'orl', type: 'circle', x: NPC.x, z: NPC.z, radius: 0.36, height: 1.72 });
  return result;
}
export function overlap(point, radius, obstacle) {
  const dx = point.x - obstacle.x,
    dz = point.z - obstacle.z;
  if (obstacle.type === 'circle') {
    const distance = Math.hypot(dx, dz),
      depth = radius + obstacle.radius - distance;
    return depth > EPS
      ? { x: distance ? dx / distance : 1, z: distance ? dz / distance : 0, depth }
      : null;
  }
  const x = obstacle.c * dx - obstacle.s * dz,
    z = obstacle.s * dx + obstacle.c * dz;
  const ex = x - clamp(x, -obstacle.hx, obstacle.hx),
    ez = z - clamp(z, -obstacle.hz, obstacle.hz),
    distance = Math.hypot(ex, ez);
  let nx, nz, depth;
  if (distance > 0) {
    if (distance >= radius - EPS) return null;
    nx = ex / distance;
    nz = ez / distance;
    depth = radius - distance;
  } else {
    const ax = obstacle.hx - Math.abs(x),
      az = obstacle.hz - Math.abs(z);
    if (ax < az) {
      nx = x < 0 ? -1 : 1;
      nz = 0;
      depth = ax + radius;
    } else {
      nx = 0;
      nz = z < 0 ? -1 : 1;
      depth = az + radius;
    }
  }
  return { x: obstacle.c * nx + obstacle.s * nz, z: -obstacle.s * nx + obstacle.c * nz, depth };
}
function riverBlocked(point, radius) {
  const width = riverHalfWidth(point.z);
  if (width < 0.7 || Math.abs(point.x - riverX(point.z)) >= width + radius) return false;
  return !(
    point.z >= BRIDGE.z + BRIDGE.minZ + radius &&
    point.z <= BRIDGE.z + BRIDGE.maxZ - radius &&
    point.x >= BRIDGE.x + BRIDGE.minX &&
    point.x <= BRIDGE.x + BRIDGE.maxX
  );
}

export class CollisionWorld {
  declare obstacles: Obstacle[];
  declare active: (obstacle: Obstacle) => boolean;
  declare river: boolean;
  declare coast: boolean;
  declare walkSurfaces: {
    local: (
      x: any,
      z: any,
    ) => {
      x: number;
      z: number;
    };
    world: (
      x: any,
      z: any,
    ) => {
      x: any;
      z: any;
    };
    cell: (
      x: any,
      z: any,
    ) => {
      ix: number;
      iz: number;
      index: number;
      p: {
        x: number;
        z: number;
      };
    } | null;
    height: (x: any, z: any) => number | null | undefined;
    free: (x: any, z: any, radius?: number) => boolean;
    transition: (a: any, b: any) => boolean;
    data: any;
    placement: any;
  }[];
  declare grid: Map<string, Obstacle[]>;

  // The shallow river is fordable, including by mounted mammoths.
  // Clients and the authoritative server must use the same default.
  constructor(
    obstacles = staticObstacles(),
    {
      active = (_obstacle: Obstacle): boolean => true,
      river = false,
      coast = true,
      walkSurfaces = [CASTLE_SURFACE],
    } = {},
  ) {
    this.obstacles = obstacles;
    this.active = active;
    this.river = river;
    this.coast = coast;
    this.walkSurfaces = walkSurfaces;
    this.grid = new Map();
    for (const o of obstacles) {
      const rx = o.radius ?? Math.abs(o.c) * o.hx + Math.abs(o.s) * o.hz,
        rz = o.radius ?? Math.abs(o.s) * o.hx + Math.abs(o.c) * o.hz;
      for (let x = Math.floor((o.x - rx) / CELL); x <= Math.floor((o.x + rx) / CELL); x++)
        for (let z = Math.floor((o.z - rz) / CELL); z <= Math.floor((o.z + rz) / CELL); z++) {
          const key = `${x},${z}`;
          if (!this.grid.has(key)) this.grid.set(key, []);
          this.grid.get(key).push(o);
        }
    }
  }
  nearby(point, radius) {
    const found = new Set<Obstacle>();
    for (
      let x = Math.floor((point.x - radius) / CELL);
      x <= Math.floor((point.x + radius) / CELL);
      x++
    )
      for (
        let z = Math.floor((point.z - radius) / CELL);
        z <= Math.floor((point.z + radius) / CELL);
        z++
      )
        for (const o of this.grid.get(`${x},${z}`) || []) if (this.active(o)) found.add(o);
    return found;
  }
  free(point, radius, dynamic = [], ignore = (_obstacle: Obstacle) => false) {
    if (
      !Number.isFinite(point.x) ||
      !Number.isFinite(point.z) ||
      point.x !== worldClamp(point.x, 'x') ||
      point.z !== worldClamp(point.z, 'z') ||
      (this.river && riverBlocked(point, radius))
    )
      return false;
    if (this.coast && !landBodyFree(point.x, point.z, radius)) return false;
    if (this.walkSurfaces.some((surface) => !surface.free(point.x, point.z, radius))) return false;
    for (const o of this.nearby(point, radius))
      if (!ignore(o) && overlap(point, radius, o)) return false;
    for (const o of dynamic) if (overlap(point, radius, o)) return false;
    return true;
  }
  move(start, dx, dz, radius, dynamic = []) {
    let point = { x: start.x, z: start.z };
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.1));
    for (let step = 0; step < steps; step++) {
      const next = {
        x: worldClamp(point.x + dx / steps, 'x'),
        z: worldClamp(point.z + dz / steps, 'z'),
      };
      for (const surface of this.walkSurfaces) {
        if (surface.free(next.x, next.z, radius) && surface.transition(point, next)) continue;
        // Raster walls and stairwell edges must slide the whole body, not just
        // its centre. Use the atlas axes: the castle is rotated in world space.
        const a = surface.local(point.x, point.z),
          b = surface.local(next.x, next.z),
          candidates = [surface.world(b.x, a.z), surface.world(a.x, b.z)]
            .filter((p) => this.free(p, radius, dynamic) && this.surfaceTransition(point, p))
            .sort(
              (a, b) =>
                Math.hypot(b.x - point.x, b.z - point.z) - Math.hypot(a.x - point.x, a.z - point.z),
            );
        Object.assign(next, candidates[0] ?? point);
      }
      if (this.coast && !landBodyFree(next.x, next.z, radius)) {
        if (landBodyFree(next.x, point.z, radius)) next.z = point.z;
        else if (landBodyFree(point.x, next.z, radius)) next.x = point.x;
        else continue;
      }
      for (let iteration = 0; iteration < 6; iteration++) {
        let adjusted = false;
        if (this.river && riverBlocked(next, radius)) {
          if (!riverBlocked({ x: next.x, z: point.z }, radius)) next.z = point.z;
          else if (!riverBlocked({ x: point.x, z: next.z }, radius)) next.x = point.x;
          else {
            next.x = point.x;
            next.z = point.z;
          }
        }
        for (const o of [...this.nearby(next, radius), ...dynamic]) {
          const hit = overlap(next, radius, o);
          if (!hit) continue;
          next.x += hit.x * (hit.depth + EPS);
          next.z += hit.z * (hit.depth + EPS);
          adjusted = true;
        }
        if (!adjusted) break;
      }
      if (this.free(next, radius, dynamic) && this.surfaceTransition(point, next)) point = next;
    }
    return point;
  }
  nearestFree(point, radius, dynamic = [], range = 8) {
    if (this.free(point, radius, dynamic)) return { x: point.x, z: point.z };
    for (let r = 0.3; r <= range; r += 0.3)
      for (let i = 0; i < 24; i++) {
        const angle = (i / 24) * Math.PI * 2,
          p = { x: point.x + Math.cos(angle) * r, z: point.z + Math.sin(angle) * r };
        if (this.free(p, radius, dynamic)) return p;
      }
    return null;
  }
  segmentFree(a, b, radius, dynamic = [], ignore = () => false) {
    const steps = Math.max(
      1,
      Math.ceil(
        Math.hypot(b.x - a.x, b.z - a.z) /
          (this.walkSurfaces.some((surface) => surface.cell?.(a.x, a.z) || surface.cell?.(b.x, b.z))
            ? 0.05
            : 0.25),
      ),
    );
    let previous = a;
    for (let i = 1; i <= steps; i++) {
      const point = { x: a.x + ((b.x - a.x) * i) / steps, z: a.z + ((b.z - a.z) * i) / steps };
      if (!this.free(point, radius, dynamic, ignore) || !this.surfaceTransition(previous, point))
        return false;
      previous = point;
    }
    return true;
  }
  surfaceTransition(a, b) {
    return this.walkSurfaces.every((surface) => surface.transition(a, b));
  }
  surfaceHeight(point) {
    for (const surface of this.walkSurfaces) {
      const h = surface.height(point.x, point.z);
      if (Number.isFinite(h)) return h;
    }
    return 0;
  }
  path(start, goal, radius, dynamic = []) {
    if (this.walkSurfaces.includes(CASTLE_SURFACE)) {
      const level = (p) => {
        const h = CASTLE_SURFACE.height(p.x, p.z) ?? 0;
        return h > 15 ? 3 : h > 10 ? 2 : h > 2 ? 1 : 0;
      };
      const from = level(start),
        to = level(goal),
        anchors = [CASTLE_GATE, castleWorld(0, 19), castleWorld(0, 11), castleWorld(0, 4)];
      if (from !== to) {
        const stops = [];
        if (from === 0 && Math.hypot(start.x - CASTLE_GATE.x, start.z - CASTLE_GATE.z) > 2)
          stops.push(CASTLE_GATE);
        for (
          let n = from + (to > from ? 1 : -1);
          to > from ? n <= to : n >= to;
          n += to > from ? 1 : -1
        )
          stops.push(anchors[n]);
        stops.push(goal);
        let point = start;
        const route = [];
        for (const stop of stops) {
          if (Math.hypot(point.x - stop.x, point.z - stop.z) < 0.02) continue;
          const leg = this.directPath(point, stop, radius, dynamic);
          if (!leg.length) return [];
          route.push(...leg);
          point = leg.at(-1);
        }
        return route;
      }
    }
    return this.directPath(start, goal, radius, dynamic);
  }
  directPath(start, goal, radius, dynamic = []) {
    if (this.coast && !isLand(goal.x, goal.z)) return [];
    if (this.coast && Math.hypot(start.x - goal.x, start.z - goal.z) > 60) {
      const a = landmassAt(start.x, start.z),
        b = landmassAt(goal.x, goal.z);
      if (a && b && a !== b) return [];
    }
    const end = this.nearestFree(goal, radius, dynamic);
    if (!end) return [];
    if (this.segmentFree(start, end, radius, dynamic)) return [end];
    // Far journeys use an eight-metre graph; only the crowded local approach
    // needs half-metre nodes. Every coarse edge still sweeps the actual colliders.
    if (Math.hypot(end.x - start.x, end.z - start.z) > 48) {
      for (const spacing of Math.hypot(end.x - start.x, end.z - start.z) > 180
        ? [16, 8, 4]
        : [8, 4]) {
        const route = this.searchPath(
          start,
          end,
          radius,
          dynamic,
          spacing,
          spacing >= 8 ? 6500 : 10000,
        );
        if (route.length) return route;
      }
    }
    return this.searchPath(
      start,
      end,
      radius,
      dynamic,
      dynamic.length ||
        this.walkSurfaces.some(
          (surface) => surface.cell?.(start.x, start.z) || surface.cell?.(end.x, end.z),
        )
        ? 0.5
        : 1,
      12000,
    );
  }
  searchPath(start, end, radius, dynamic, spacing, budget) {
    const nodes = new Map(),
      open = new MinHeap(),
      closed = new Set();
    const id = (x, z) => `${x},${z}`,
      heuristic = (x, z) => Math.hypot(end.x - x, end.z - z);
    const first = {
      x: start.x,
      z: start.z,
      g: 0,
      f: heuristic(start.x, start.z),
      parent: null,
      key: 'start',
    };
    open.push(first);
    const directions = [
      [-1, -1],
      [-1, 0],
      [-1, 1],
      [0, -1],
      [0, 1],
      [1, -1],
      [1, 0],
      [1, 1],
    ];
    const portals = this.river
      ? [
          { x: BRIDGE.x + BRIDGE.minX - 1, z: BRIDGE.z },
          { x: BRIDGE.x + BRIDGE.maxX + 1, z: BRIDGE.z },
        ]
      : [];
    let found = null,
      visited = 0;
    while (open.length && visited++ < budget) {
      const node = open.pop();
      if (closed.has(node.key)) continue;
      closed.add(node.key);
      if (
        heuristic(node.x, node.z) < Math.max(1.6, spacing * 1.5) &&
        this.segmentFree(node, end, radius, dynamic)
      ) {
        found = node;
        break;
      }
      const neighbours = directions.map(([dx, dz]) => ({
        x: (Math.round(node.x / spacing) + dx) * spacing,
        z: (Math.round(node.z / spacing) + dz) * spacing,
      }));
      if (spacing > 1)
        for (const portal of portals)
          if (Math.hypot(portal.x - node.x, portal.z - node.z) < 16) neighbours.push(portal);
      for (const { x, z } of neighbours) {
        const key = id(x, z);
        if (
          closed.has(key) ||
          !this.free({ x, z }, radius, dynamic) ||
          !this.segmentFree(node, { x, z }, radius, dynamic)
        )
          continue;
        const g = node.g + Math.hypot(x - node.x, z - node.z);
        if (nodes.has(key) && nodes.get(key) <= g) continue;
        nodes.set(key, g);
        open.push({ x, z, g, f: g + heuristic(x, z), parent: node, key });
      }
    }
    if (!found) return [];
    const reverse = [end];
    for (let n = found; n?.parent; n = n.parent) reverse.push({ x: n.x, z: n.z });
    reverse.reverse();
    const result = [];
    let anchor = start;
    for (let i = 0; i < reverse.length;) {
      let far = i;
      while (
        far + 1 < reverse.length &&
        this.segmentFree(anchor, reverse[far + 1], radius, dynamic)
      )
        far++;
      result.push(reverse[far]);
      anchor = reverse[far];
      i = far + 1;
    }
    return result;
  }
  cameraDistance(origin, direction, maximum) {
    let distance = maximum;
    const middle = {
      x: origin.x + (direction.x * maximum) / 2,
      z: origin.z + (direction.z * maximum) / 2,
    };
    for (const o of this.nearby(middle, maximum / 2 + 0.25)) {
      if (o.type !== 'box') continue;
      const ox = o.c * (origin.x - o.x) - o.s * (origin.z - o.z),
        oz = o.s * (origin.x - o.x) + o.c * (origin.z - o.z);
      const dx = o.c * direction.x - o.s * direction.z,
        dz = o.s * direction.x + o.c * direction.z;
      let lo = 0,
        hi = maximum;
      const base = terrainHeight(o.groundX ?? o.x, o.groundZ ?? o.z) + (o.groundOffset ?? 0);
      for (const [p, d, min, max] of [
        [ox, dx, -o.hx - 0.12, o.hx + 0.12],
        [oz, dz, -o.hz - 0.12, o.hz + 0.12],
        [origin.y, direction.y, base, base + o.height + 0.12],
      ]) {
        if (Math.abs(d) < 1e-8) {
          if (p < min || p > max) {
            hi = -1;
            break;
          }
        } else {
          const a = (min - p) / d,
            b = (max - p) / d;
          lo = Math.max(lo, Math.min(a, b));
          hi = Math.min(hi, Math.max(a, b));
        }
      }
      if (hi >= lo && hi >= 0) distance = Math.min(distance, Math.max(0.6, lo - 0.15));
    }
    return distance;
  }
}
class MinHeap {
  declare items: { x: number; z: number; f: number; g: number; key: string }[];
  constructor() {
    this.items = [];
  }
  get length() {
    return this.items.length;
  }
  push(node) {
    const a = this.items;
    let i = a.length;
    a.push(node);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f <= node.f) break;
      a[i] = a[p];
      i = p;
    }
    a[i] = node;
  }
  pop() {
    const a = this.items,
      first = a[0],
      last = a.pop();
    if (a.length) {
      let i = 0;
      while (i * 2 + 1 < a.length) {
        let c = i * 2 + 1;
        if (c + 1 < a.length && a[c + 1].f < a[c].f) c++;
        if (a[c].f >= last.f) break;
        a[i] = a[c];
        i = c;
      }
      a[i] = last;
    }
    return first;
  }
}
