// Offline authoring aid; never connects to saved game rooms.
import { mountainHeight as height } from '../dist/shared/camp-mountain.mjs';
import { CollisionWorld } from '../dist/shared/collision.mjs';
import { insideCaveGround } from '../dist/shared/camp-cave-layout.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
const col = new CollisionWorld(),
  N = 157,
  M = 81;
const pts = Array.from({ length: N * M }, (_, i) => ({
  x: -100 + (i % N),
  z: 56 + Math.floor(i / N),
}));
const heights = pts.map((p) => height(p.x, p.z));
const free = pts.map((p) => !insideCaveGround(p.x, p.z) && col.free(p, 0.85));
const id = (x, z) => (z - 56) * N + x + 100,
  start = id(50, 62),
  goal = id(-68, 122);
const cost = new Float64Array(pts.length).fill(Infinity),
  prev = new Int32Array(pts.length).fill(-1),
  open = [start],
  done = new Set();
cost[start] = 0;
const grade = (a, b) => {
  let max = 0,
    old = height(a.x, a.z),
    n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.2),
    step = Math.hypot(b.x - a.x, b.z - a.z) / n;
  for (let i = 1; i <= n; i++) {
    const h = height(a.x + ((b.x - a.x) * i) / n, a.z + ((b.z - a.z) * i) / n);
    max = Math.max(max, Math.abs(h - old) / step);
    old = h;
  }
  return max;
};
const dirs = [];
for (let dz = -2; dz <= 2; dz++)
  for (let dx = -2; dx <= 2; dx++)
    if ((dx || dz) && !(Math.abs(dx) === 2 && Math.abs(dz) === 2)) dirs.push([dx, dz]);
while (open.length) {
  let at = 0,
    best = Infinity;
  for (let i = 0; i < open.length; i++) {
    const q = open[i],
      p = pts[q],
      v = cost[q] + Math.hypot(p.x - pts[goal].x, p.z - pts[goal].z);
    if (v < best) {
      best = v;
      at = i;
    }
  }
  const q = open.splice(at, 1)[0];
  if (done.has(q)) continue;
  done.add(q);
  if (q === goal) break;
  for (const [dx, dz] of dirs) {
    const ix = (q % N) + dx,
      iz = Math.floor(q / N) + dz;
    if (ix < 0 || ix >= N || iz < 0 || iz >= M) continue;
    const r = iz * N + ix;
    if (!free[r] || done.has(r)) continue;
    const d = Math.hypot(dx, dz);
    if (
      Math.abs(heights[q] - heights[r]) / d > 0.345 ||
      grade(pts[q], pts[r]) > 0.345 ||
      !col.segmentFree(pts[q], pts[r], 0.85)
    )
      continue;
    const c = cost[q] + d + Math.abs(heights[q] - heights[r]) * 0.15;
    if (c < cost[r]) {
      cost[r] = c;
      prev[r] = q;
      open.push(r);
    }
  }
}
if (!Number.isFinite(cost[goal])) throw Error(`No gentle route; reached ${done.size} cells`);
const path = [];
for (let q = goal; q !== -1; q = prev[q]) path.push(pts[q]);
path.reverse();
const simplified = [path[0]];
for (let i = 0; i < path.length - 1;) {
  let end = i + 1;
  for (let j = path.length - 1; j > i + 1; j--)
    if (grade(path[i], path[j]) < 0.345 && col.segmentFree(path[i], path[j], 0.85)) {
      end = j;
      break;
    }
  simplified.push(path[end]);
  i = end;
}
await mkdir('output/cave-foothill', { recursive: true });
await writeFile('output/cave-foothill/trail.json', JSON.stringify(simplified, null, 2));
console.log(
  JSON.stringify({
    cost: cost[goal],
    path: simplified.map((p) => ({ ...p, y: height(p.x, p.z) })),
  }),
);
