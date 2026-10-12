import { isMesh } from './three-types.js';
import * as THREE from 'three';

/** A cell's map key: its integer coordinates packed into one exact number
 * (distinct for coordinates within ±2^20 cells, far beyond any world). */
const cellKey = (x: number, z: number) => (x + 0x100000) * 0x200000 + (z + 0x100000);

const edge0 = new THREE.Vector3(),
  edge1 = new THREE.Vector3(),
  normal = new THREE.Vector3(),
  offset = new THREE.Vector3(),
  contact = new THREE.Vector3(),
  nearest = new THREE.Vector3(),
  sweptTriangle = new THREE.Triangle(),
  nearTriangle = new THREE.Triangle();

/** The distance a sphere of `radius` centred on `origin` travels along the unit `direction`
 * until it first meets the point `v`, or Infinity. */
function sweepPoint(
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  radius: number,
  v: THREE.Vector3,
) {
  offset.subVectors(origin, v);
  const b = offset.dot(direction),
    c = offset.lengthSq() - radius * radius,
    disc = b * b - c;
  if (c < 0 || disc < 0) return Infinity;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : Infinity;
}

/** The same for the segment from `p` to `q`, its ends excepted (sweepPoint meets those). */
function sweepEdge(
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  radius: number,
  p: THREE.Vector3,
  q: THREE.Vector3,
) {
  edge0.subVectors(q, p);
  offset.subVectors(origin, p);
  const ee = edge0.lengthSq(),
    ed = edge0.dot(direction),
    ew = edge0.dot(offset);
  const a = ee - ed * ed,
    b = ee * offset.dot(direction) - ed * ew,
    c = ee * (offset.lengthSq() - radius * radius) - ew * ew;
  // Moving along the edge, or already within reach of its line beyond its ends.
  if (a < 1e-12 || c < 0) return Infinity;
  const disc = b * b - a * c;
  if (disc < 0) return Infinity;
  const t = (-b - Math.sqrt(disc)) / a;
  if (t < 0) return Infinity;
  const along = ew + t * ed;
  return along >= 0 && along <= ee ? t : Infinity;
}

/**
 * The distance a sphere of `radius` centred on `origin` travels along the unit `direction`
 * until it first touches the triangle (a, b, c), from either side, or Infinity. A triangle
 * the sphere already overlaps at the origin is kept at the clearance it has there: the sweep
 * never brings the sphere closer to it, and does not stop at once for it either.
 */
export function sweepTriangle(
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  radius: number,
  a: THREE.Vector3,
  b: THREE.Vector3,
  c: THREE.Vector3,
) {
  sweptTriangle.set(a, b, c);
  let r = radius;
  // Only a triangle whose box is within reach of the origin needs its exact clearance.
  if (
    Math.hypot(
      Math.max(Math.min(a.x, b.x, c.x) - origin.x, 0, origin.x - Math.max(a.x, b.x, c.x)),
      Math.max(Math.min(a.y, b.y, c.y) - origin.y, 0, origin.y - Math.max(a.y, b.y, c.y)),
      Math.max(Math.min(a.z, b.z, c.z) - origin.z, 0, origin.z - Math.max(a.z, b.z, c.z)),
    ) < radius
  ) {
    sweptTriangle.closestPointToPoint(origin, nearest);
    r = Math.min(radius, nearest.distanceTo(origin) - 1e-4);
    if (r <= 0) return Infinity;
  }
  edge0.subVectors(b, a);
  edge1.subVectors(c, a);
  normal.crossVectors(edge0, edge1);
  const area = normal.length();
  if (area < 1e-12) return Infinity;
  normal.divideScalar(area);
  let s = offset.subVectors(origin, a).dot(normal),
    toward = direction.dot(normal);
  if (s < 0) {
    s = -s;
    toward = -toward;
    normal.negate();
  }
  if (s > r) {
    // The face is met first where the sphere reaches its plane inside the triangle.
    if (toward >= -1e-12) return Infinity;
    const t = (s - r) / -toward;
    contact.copy(origin).addScaledVector(direction, t).addScaledVector(normal, -r);
    if (sweptTriangle.containsPoint(contact)) return t;
  }
  return Math.min(
    sweepEdge(origin, direction, r, a, b),
    sweepEdge(origin, direction, r, b, c),
    sweepEdge(origin, direction, r, c, a),
    sweepPoint(origin, direction, r, a),
    sweepPoint(origin, direction, r, b),
    sweepPoint(origin, direction, r, c),
  );
}

/** How far a model must stay from a camera for its near plane not to cut into the model: the
 * distance to the near plane's corners, and a margin. The radius a camera sweeps (sweep). */
export function nearPlaneReach(camera: THREE.PerspectiveCamera) {
  const half = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  return camera.near * Math.sqrt(1 + half * half * (1 + camera.aspect * camera.aspect)) + 0.05;
}

// Invisible spatial index of the exact source triangles, shared by camera rays.
export class MeshRayGrid {
  declare cellSize: number;
  /** The triangles (ids into `vertices`, nine floats each) touching each cell. */
  declare cells: Map<number, number[]>;
  declare vertices: Float32Array<ArrayBuffer>;
  /** Each triangle's bounding sphere (centre and radius, four floats), for quick rejection. */
  declare spheres: Float32Array<ArrayBuffer>;
  declare a: THREE.Vector3;
  declare b: THREE.Vector3;
  declare c: THREE.Vector3;
  declare hit: THREE.Vector3;
  declare ray: THREE.Ray;
  /** The last query that met each triangle, so a sweep tests a triangle once. */
  private marks: Uint32Array | null = null;
  private query = 0;

  /** `keep`, when given, leaves out the triangles it rejects (given their corners in the
   * mesh's own coordinates, as a vertex shader sees them). */
  constructor(
    root,
    cellSize = 2,
    keep: ((a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => boolean) | null = null,
  ) {
    this.cellSize = cellSize;
    this.cells = new Map();
    const a = new THREE.Vector3(),
      b = new THREE.Vector3(),
      c = new THREE.Vector3();
    root.updateMatrixWorld(true);
    const meshes: THREE.Mesh[] = [];
    let triangles = 0;
    root.traverse((node) => {
      if (!isMesh(node)) return;
      meshes.push(node);
      const { index, attributes } = node.geometry;
      triangles += Math.ceil((index?.count ?? attributes.position.count) / 3);
    });
    let vertices = new Float32Array(triangles * 9),
      spheres = new Float32Array(triangles * 4);
    let id = 0;
    for (const node of meshes) {
      const p = node.geometry.attributes.position,
        index = node.geometry.index,
        count = index?.count ?? p.count,
        matrix = node.matrixWorld;
      for (let i = 0; i < count; i += 3) {
        a.fromBufferAttribute(p, index ? index.getX(i) : i);
        b.fromBufferAttribute(p, index ? index.getX(i + 1) : i + 1);
        c.fromBufferAttribute(p, index ? index.getX(i + 2) : i + 2);
        if (keep && !keep(a, b, c)) continue;
        a.applyMatrix4(matrix);
        b.applyMatrix4(matrix);
        c.applyMatrix4(matrix);
        a.toArray(vertices, id * 9);
        b.toArray(vertices, id * 9 + 3);
        c.toArray(vertices, id * 9 + 6);
        const sx = (a.x + b.x + c.x) / 3,
          sy = (a.y + b.y + c.y) / 3,
          sz = (a.z + b.z + c.z) / 3;
        spheres[id * 4] = sx;
        spheres[id * 4 + 1] = sy;
        spheres[id * 4 + 2] = sz;
        // A little wider than the corners, which are stored rounded to float32.
        spheres[id * 4 + 3] =
          Math.sqrt(
            Math.max(
              (a.x - sx) ** 2 + (a.y - sy) ** 2 + (a.z - sz) ** 2,
              (b.x - sx) ** 2 + (b.y - sy) ** 2 + (b.z - sz) ** 2,
              (c.x - sx) ** 2 + (c.y - sy) ** 2 + (c.z - sz) ** 2,
            ),
          ) + 1e-3;
        // Cells from the unrounded corners, as the stored float32 corners are tested.
        const x1 = Math.floor(Math.max(a.x, b.x, c.x) / cellSize),
          z0 = Math.floor(Math.min(a.z, b.z, c.z) / cellSize),
          z1 = Math.floor(Math.max(a.z, b.z, c.z) / cellSize);
        for (let x = Math.floor(Math.min(a.x, b.x, c.x) / cellSize); x <= x1; x++)
          for (let z = z0; z <= z1; z++) {
            const key = cellKey(x, z),
              cell = this.cells.get(key);
            if (cell) cell.push(id);
            else this.cells.set(key, [id]);
          }
        id++;
      }
    }
    if (id < triangles) {
      vertices = vertices.slice(0, id * 9);
      spheres = spheres.slice(0, id * 4);
    }
    this.vertices = vertices;
    this.spheres = spheres;
    this.a = a;
    this.b = b;
    this.c = c;
    this.hit = new THREE.Vector3();
    this.ray = new THREE.Ray();
  }
  /** The triangles of the cell holding the world point (x, z). */
  cell(x: number, z: number): readonly number[] {
    return (
      this.cells.get(cellKey(Math.floor(x / this.cellSize), Math.floor(z / this.cellSize))) ?? []
    );
  }
  distance(origin, direction, maximum) {
    this.ray.set(origin, direction);
    const ids = new Set<number>(),
      n = Math.ceil(maximum / (this.cellSize / 3));
    for (let i = 0; i <= n; i++) {
      const t = (maximum * i) / n;
      for (const id of this.cell(origin.x + direction.x * t, origin.z + direction.z * t))
        ids.add(id);
    }
    let result = maximum;
    for (const id of ids) {
      this.a.fromArray(this.vertices, id * 9);
      this.b.fromArray(this.vertices, id * 9 + 3);
      this.c.fromArray(this.vertices, id * 9 + 6);
      if (this.ray.intersectTriangle(this.a, this.b, this.c, false, this.hit)) {
        const d = this.hit.distanceTo(origin);
        if (d > 0.08) result = Math.min(result, Math.max(0.35, d - 0.2));
      }
    }
    return result;
  }
  /** The distance from `point` to the nearest triangle, when nearer than `limit` (else
   * `limit`). */
  clearance(point: THREE.Vector3, limit: number) {
    const size = this.cellSize,
      vertices = this.vertices,
      spheres = this.spheres,
      { a, b, c } = this;
    let best = limit;
    for (
      let x = Math.floor((point.x - limit) / size);
      x <= Math.floor((point.x + limit) / size);
      x++
    )
      for (
        let z = Math.floor((point.z - limit) / size);
        z <= Math.floor((point.z + limit) / size);
        z++
      )
        for (const id of this.cells.get(cellKey(x, z)) ?? []) {
          const i = id * 9,
            k = id * 4,
            dx = spheres[k] - point.x,
            dy = spheres[k + 1] - point.y,
            dz = spheres[k + 2] - point.z,
            within = spheres[k + 3] + best;
          if (dx * dx + dy * dy + dz * dz >= within * within) continue;
          nearTriangle.set(
            a.fromArray(vertices, i),
            b.fromArray(vertices, i + 3),
            c.fromArray(vertices, i + 6),
          );
          best = Math.min(best, nearTriangle.closestPointToPoint(point, nearest).distanceTo(point));
        }
    return best;
  }
  /**
   * How far a sphere of `radius` moves from `origin` along the unit `direction`, at most
   * `maximum`, before it touches the model. The camera keeps its near plane out of the model
   * this way, where a single ray lets it graze a wall. A sphere that starts nearer the model
   * than its radius keeps the clearance it has (the focus of a player pressed to a wall):
   * it never closes in, and is not stopped at once either.
   */
  sweep(origin: THREE.Vector3, direction: THREE.Vector3, maximum: number, radius: number) {
    const start = this.clearance(origin, radius) - 1e-3;
    return this.sweepRadius(origin, direction, maximum, Math.max(1e-6, Math.min(radius, start)));
  }
  /** sweep() with exactly this radius (sweepTriangle). Cells are visited nearest first and
   * the search stops beyond the first contact. */
  sweepRadius(origin: THREE.Vector3, direction: THREE.Vector3, maximum: number, radius: number) {
    const size = this.cellSize,
      count = this.vertices.length / 9;
    if (!this.marks || this.marks.length < count) this.marks = new Uint32Array(count);
    const marks = this.marks;
    const mark = (this.query = (this.query + 1) >>> 0 || 1);
    const ex = origin.x + direction.x * maximum,
      ez = origin.z + direction.z * maximum;
    const flat = direction.x * direction.x + direction.z * direction.z;
    // Reach from a cell's centre to its corners, plus the sphere.
    const reach = size * Math.SQRT1_2 + radius;
    const cells: { key: number; enter: number }[] = [];
    for (
      let x = Math.floor((Math.min(origin.x, ex) - radius) / size);
      x <= Math.floor((Math.max(origin.x, ex) + radius) / size);
      x++
    )
      for (
        let z = Math.floor((Math.min(origin.z, ez) - radius) / size);
        z <= Math.floor((Math.max(origin.z, ez) + radius) / size);
        z++
      ) {
        const key = cellKey(x, z);
        if (!this.cells.has(key)) continue;
        const cx = (x + 0.5) * size - origin.x,
          cz = (z + 0.5) * size - origin.z;
        // Where the path's ground track passes the cell's centre, and how far it is from it.
        const along = flat > 1e-9 ? (cx * direction.x + cz * direction.z) / flat : 0;
        const t = Math.max(0, Math.min(maximum, along));
        if (Math.hypot(cx - direction.x * t, cz - direction.z * t) > reach) continue;
        cells.push({ key, enter: flat > 1e-9 ? along - reach / Math.sqrt(flat) : 0 });
      }
    cells.sort((p, q) => p.enter - q.enter);
    let best = maximum;
    const { a, b, c } = this,
      vertices = this.vertices,
      spheres = this.spheres;
    for (const { key, enter } of cells) {
      if (enter > best) break;
      for (const id of this.cells.get(key)!) {
        if (marks[id] === mark) continue;
        marks[id] = mark;
        const i = id * 9,
          k = id * 4;
        // The triangle's sphere must come within reach of the path so far (to the first
        // contact found): most of a cell's walls, roof and floor do not.
        const cx = spheres[k],
          cy = spheres[k + 1],
          cz = spheres[k + 2],
          spread = spheres[k + 3] + radius;
        const wx = cx - origin.x,
          wy = cy - origin.y,
          wz = cz - origin.z;
        const along = Math.min(
          Math.max(wx * direction.x + wy * direction.y + wz * direction.z, 0),
          best,
        );
        const gx = wx - direction.x * along,
          gy = wy - direction.y * along,
          gz = wz - direction.z * along;
        if (gx * gx + gy * gy + gz * gz > spread * spread) continue;
        a.fromArray(vertices, i);
        b.fromArray(vertices, i + 3);
        c.fromArray(vertices, i + 6);
        const t = sweepTriangle(origin, direction, radius, a, b, c);
        if (t < best) best = t;
      }
    }
    return best;
  }
}
