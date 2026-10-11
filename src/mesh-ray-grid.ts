import { isMesh } from './three-types.js';
import * as THREE from 'three';

/** A cell's map key: its integer coordinates packed into one exact number
 * (distinct for coordinates within ±2^20 cells, far beyond any world). */
const cellKey = (x: number, z: number) => (x + 0x100000) * 0x200000 + (z + 0x100000);

// Invisible spatial index of the exact source triangles, shared by camera rays.
export class MeshRayGrid {
  declare cellSize: number;
  /** The triangles (ids into `vertices`, nine floats each) touching each cell. */
  declare cells: Map<number, number[]>;
  declare vertices: Float32Array<ArrayBuffer>;
  declare a: THREE.Vector3;
  declare b: THREE.Vector3;
  declare c: THREE.Vector3;
  declare hit: THREE.Vector3;
  declare ray: THREE.Ray;

  constructor(root, cellSize = 2) {
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
    const vertices = new Float32Array(triangles * 9);
    let id = 0;
    for (const node of meshes) {
      const p = node.geometry.attributes.position,
        index = node.geometry.index,
        count = index?.count ?? p.count,
        matrix = node.matrixWorld;
      for (let i = 0; i < count; i += 3, id++) {
        a.fromBufferAttribute(p, index ? index.getX(i) : i).applyMatrix4(matrix);
        b.fromBufferAttribute(p, index ? index.getX(i + 1) : i + 1).applyMatrix4(matrix);
        c.fromBufferAttribute(p, index ? index.getX(i + 2) : i + 2).applyMatrix4(matrix);
        a.toArray(vertices, id * 9);
        b.toArray(vertices, id * 9 + 3);
        c.toArray(vertices, id * 9 + 6);
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
      }
    }
    this.vertices = vertices;
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
}
