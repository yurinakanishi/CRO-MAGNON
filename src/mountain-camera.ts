import * as THREE from 'three';
import { MeshRayGrid } from './mesh-ray-grid.js';
import { mountainCaveClipped } from './mountain-materials.js';
import { isMesh } from './three-types.js';

const reach = new THREE.Box3(),
  end = new THREE.Vector3();

type Chunk = { mesh: THREE.Mesh; bounds: THREE.Box3; grid: MeshRayGrid | null };

/**
 * The camp mountain as the camera meets it. Its drawn level is a continuous surface split
 * into 64 m chunks (surface-chunks.ts); a chunk's exact triangles are indexed the first time a
 * camera sweep reaches it, at most one chunk a frame (a dense chunk takes a few milliseconds).
 * The hillside the mountain shader discards inside the cave's rock envelope is left out: the
 * cave model is seen there, and the cave's own grid keeps the camera inside it.
 */
export class MountainCamera {
  private chunks = new WeakMap<THREE.Object3D, Chunk[]>();
  private budget = 1;
  /** Chunks indexed so far (diagnostics). */
  indexed = 0;

  constructor(private root: THREE.LOD) {}

  /** A new frame: one more chunk may be indexed. */
  frame() {
    this.budget = 1;
  }

  /** The drawn level's chunks, listed once per filled level. */
  private drawn(): Chunk[] {
    const level = this.root.levels.find((record) => record.object.visible)?.object;
    const model = level?.children[0];
    if (!model) return [];
    let chunks = this.chunks.get(model);
    if (!chunks) {
      chunks = [];
      model.updateMatrixWorld(true);
      model.traverse((node) => {
        if (!isMesh(node)) return;
        const geometry = node.geometry;
        if (!geometry.boundingBox) geometry.computeBoundingBox();
        chunks!.push({
          mesh: node,
          bounds: geometry.boundingBox!.clone().applyMatrix4(node.matrixWorld),
          grid: null,
        });
      });
      this.chunks.set(model, chunks);
    }
    return chunks;
  }

  /** How far a sphere of `radius` moves from `origin` along the unit `direction`, at most
   * `maximum`, before it touches the drawn mountain (MeshRayGrid.sweep). A chunk not yet
   * indexed is passed; the camera's floor height still keeps it above the slope. */
  sweep(origin: THREE.Vector3, direction: THREE.Vector3, maximum: number, radius: number) {
    end.copy(origin).addScaledVector(direction, maximum);
    reach.makeEmpty().expandByPoint(origin).expandByPoint(end).expandByScalar(radius);
    const chunks: MeshRayGrid[] = [];
    for (const chunk of this.drawn()) {
      if (!chunk.bounds.intersectsBox(reach)) continue;
      if (!chunk.grid) {
        if (this.budget <= 0) continue;
        this.budget--;
        chunk.grid = new MeshRayGrid(chunk.mesh, 2, (a, b, c) =>
          [a, b, c].some((p) => !mountainCaveClipped(p.x, p.y, p.z)),
        );
        this.indexed++;
      }
      chunks.push(chunk.grid);
    }
    // One surface across its chunks: the clearance the origin keeps is its nearest of all.
    let clear = radius;
    for (const grid of chunks) clear = grid.clearance(origin, clear);
    const swept = Math.max(1e-6, Math.min(radius, clear - 1e-3));
    let best = maximum;
    for (const grid of chunks)
      best = Math.min(best, grid.sweepRadius(origin, direction, best, swept));
    return best;
  }
}
