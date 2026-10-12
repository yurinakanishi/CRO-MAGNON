import * as THREE from 'three';
import { skinnedDistance } from './skinned-bounds.js';
import { isMesh, isSkinnedMesh } from './three-types.js';

type Worn = THREE.Material | THREE.Material[];

const centre = new THREE.Vector3();

/** Whether the node and every ancestor are drawn. */
function shown(node: THREE.Object3D) {
  for (let n: THREE.Object3D | null = node; n; n = n.parent) if (!n.visible) return false;
  return true;
}

/** The distance from a world point to an actor as drawn (its roots): its skinned bodies' bone
 * boxes (skinnedDistance) and the bounding spheres of what it carries (a weapon, a torch). */
export function actorDistance(roots: readonly THREE.Object3D[], point: THREE.Vector3) {
  let nearest = Infinity;
  for (const root of roots)
    root.traverse((node) => {
      if (!isMesh(node) || !shown(node)) return;
      if (isSkinnedMesh(node)) nearest = Math.min(nearest, skinnedDistance(node, point));
      else {
        const geometry = node.geometry;
        if (!geometry.boundingSphere) geometry.computeBoundingSphere();
        const sphere = geometry.boundingSphere!;
        centre.copy(sphere.center).applyMatrix4(node.matrixWorld);
        nearest = Math.min(
          nearest,
          centre.distanceTo(point) - sphere.radius * node.matrixWorld.getMaxScaleOnAxis(),
        );
      }
    });
  return Math.max(0, nearest);
}

/**
 * An actor drawn faded for the camera, which has come close to it: dithered (alphaHash keeps
 * it opaque-sorted and depth-tested, no blending order) and, at no opacity, not drawn. The
 * actor's meshes wear this fade's own copies of their materials meanwhile: actors of one
 * model share theirs (character-assets.ts), and those never change. A mesh given another
 * material while faded (an actor LOD switch) wears that one's copy from the next frame.
 */
export class ActorFade {
  private copies = new Map<THREE.Material, THREE.Material>();
  private made = new Set<THREE.Material>();
  private worn = new Map<THREE.Mesh, Worn>();
  private prepared = false;
  /** The dithered copies' programs are linked (prepare): partial fades draw from then on. */
  ready = false;
  opacity = 1;

  /** `roots` hold what is drawn of the actor: its model and anything it carries outside it. */
  constructor(readonly roots: readonly THREE.Object3D[]) {}

  private meshes(visit: (mesh: THREE.Mesh) => void) {
    for (const root of this.roots)
      root.traverse((node) => {
        if (isMesh(node)) visit(node);
      });
  }

  private copyOf(material: THREE.Material) {
    let copy = this.copies.get(material);
    if (!copy) {
      copy = material.clone();
      // Material.copy drops program hooks (onBeforeCompile, customProgramCacheKey).
      const source = material as unknown as Record<string, unknown>,
        target = copy as unknown as Record<string, unknown>;
      for (const key of Object.keys(source))
        if (typeof source[key] === 'function') target[key] = source[key];
      copy.userData = material.userData;
      if (material.defines) copy.defines = { ...material.defines };
      copy.alphaHash = true;
      this.copies.set(material, copy);
      this.made.add(copy);
    }
    return copy;
  }

  private isCopy(worn: Worn) {
    return Array.isArray(worn) ? worn.every((m) => this.made.has(m)) : this.made.has(worn);
  }

  /** Draw the actor at this opacity: 1 gives its meshes back their own materials. Until the
   * dithered programs are ready, a partial fade would link them on its frame, so the actor
   * is shown or not drawn instead (an undrawn copy needs no program). */
  set(opacity: number) {
    let value = Math.min(Math.max(opacity, 0), 1);
    if (!this.ready && value > 0 && value < 0.999) value = value < 0.5 ? 0 : 1;
    this.opacity = value;
    if (this.opacity >= 0.999) {
      this.restore();
      return;
    }
    this.meshes((mesh) => {
      const current = mesh.material;
      if (this.isCopy(current)) return;
      this.worn.set(mesh, current);
      mesh.material = Array.isArray(current)
        ? current.map((material) => this.copyOf(material))
        : this.copyOf(current);
    });
    for (const [original, copy] of this.copies) {
      copy.opacity = original.opacity * this.opacity;
      copy.visible = original.visible && this.opacity > 0.02;
    }
  }

  /** Compile the dithered copies' programs with the scene's lights, while nothing is faded;
   * a parallel-compiling driver links them in the background, and `ready` follows. */
  prepare(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    if (this.prepared || this.worn.size) return;
    this.prepared = true;
    const restore: [THREE.Mesh, Worn][] = [];
    this.meshes((mesh) => {
      restore.push([mesh, mesh.material]);
      mesh.material = Array.isArray(mesh.material)
        ? mesh.material.map((material) => this.copyOf(material))
        : this.copyOf(mesh.material);
    });
    let linked: Promise<unknown>;
    try {
      // compileAsync compiles before it first waits: the copies can be taken off at once.
      linked = Promise.all(this.roots.map((root) => renderer.compileAsync(root, camera, scene)));
    } finally {
      for (const [mesh, material] of restore) mesh.material = material;
    }
    linked.then(() => (this.ready = true)).catch(() => {});
  }

  /** The actor's own materials, back on every mesh that still wears this fade's copies. */
  restore() {
    for (const [mesh, original] of this.worn)
      if (this.isCopy(mesh.material)) mesh.material = original;
    this.worn.clear();
    this.opacity = 1;
  }

  dispose() {
    this.restore();
    for (const copy of this.made) copy.dispose();
    this.copies.clear();
    this.made.clear();
  }
}
