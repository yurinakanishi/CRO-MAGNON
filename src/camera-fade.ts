import * as THREE from 'three';
import { skinnedDistance } from './skinned-bounds.js';
import { isMesh, isSkinnedMesh } from './three-types.js';
import { compileScene } from './context-recovery.js';

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
 * it opaque-sorted and depth-tested, with no blending order) and, at no opacity, not drawn.
 * The meshes wear this fade's own copies of their materials, since actors of one model share
 * theirs (character-assets.ts) and those never change. A copy is drawn only once its program
 * is linked (link): a mesh whose copy is still compiling is shown as it is, or not drawn
 * (a copy that is not drawn needs no program).
 *
 * A steady fade (the player's own actor) keeps wearing its linked copies at full opacity
 * too: they are then compiled whenever the scene's lights change, as the actor's own
 * materials would be, and a fade only sets a uniform, never a program, on its frame. Another
 * fade wears copies only while the actor is hidden. A mesh given another material (an actor
 * LOD switch) wears that material's copy once it is linked.
 */
export class ActorFade {
  private copies = new Map<THREE.Material, THREE.Material>();
  private made = new Set<THREE.Material>();
  /** Copies whose programs are linked. */
  private linked = new Set<THREE.Material>();
  private linking = false;
  /** Each mesh's own material while it wears a copy. */
  private worn = new Map<THREE.Mesh, Worn>();
  opacity = 1;

  /** `roots` hold what is drawn of the actor: its model and anything it carries outside it. */
  constructor(
    readonly roots: readonly THREE.Object3D[],
    readonly steady = false,
  ) {}

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

  private copiesOf(materials: Worn) {
    return Array.isArray(materials)
      ? materials.map((material) => this.copyOf(material))
      : this.copyOf(materials);
  }

  private isLinked(copies: Worn) {
    return Array.isArray(copies)
      ? copies.every((m) => this.linked.has(m))
      : this.linked.has(copies);
  }

  /**
   * Draw the actor at this opacity, every frame it may change. With `link`, copies not yet
   * linked are compiled in the background with that scene's lights; without
   * it, nothing is compiled.
   */
  set(
    opacity: number,
    link: { renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.Camera } | null = null,
  ) {
    this.opacity = Math.min(Math.max(opacity, 0), 1);
    const hidden = this.opacity <= 0.02,
      unlinked: [THREE.Mesh, Worn][] = [];
    this.meshes((mesh) => {
      const current = mesh.material,
        own = this.isCopy(current) ? this.worn.get(mesh)! : current,
        copies = this.copiesOf(own);
      const ready = this.isLinked(copies),
        // Not linked yet: shown as it is, or not drawn below half.
        out = hidden || (!ready && this.opacity < 0.5),
        wear = out || (ready && (this.steady || this.opacity < 0.999));
      if (wear) {
        this.worn.set(mesh, own);
        mesh.material = copies;
      } else {
        mesh.material = own;
        this.worn.delete(mesh);
      }
      if (!ready) unlinked.push([mesh, copies]);
    });
    for (const [original, copy] of this.copies) {
      copy.opacity = original.opacity * this.opacity;
      copy.visible = original.visible && !hidden && (this.linked.has(copy) || this.opacity >= 0.5);
    }
    if (link && unlinked.length && !this.linking) this.link(unlinked, link);
  }

  /** Compile these meshes' copies (their programs follow these meshes' kinds: skinned, morph
   * targets) and mark them linked when a parallel-compiling driver has linked them. */
  private link(
    meshes: [THREE.Mesh, Worn][],
    {
      renderer,
      scene,
      camera,
    }: { renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.Camera },
  ) {
    this.linking = true;
    const worn = meshes.map(([mesh]) => [mesh, mesh.material] as const),
      copies = new Set(meshes.flatMap(([, copies]) => (Array.isArray(copies) ? copies : [copies])));
    for (const [mesh, copies] of meshes) mesh.material = copies;
    let compiled: Promise<unknown>;
    try {
      // Compile before restoring the worn materials. A character switch may dispose the
      // copies while their programs are pending, so use the disposal-aware waiter.
      compiled = Promise.all(this.roots.map((root) => compileScene(renderer, root, camera, scene)));
    } finally {
      for (const [mesh, material] of worn) mesh.material = material;
    }
    compiled
      .then(() => {
        for (const copy of copies) if (this.made.has(copy)) this.linked.add(copy);
      })
      .catch(() => {})
      .finally(() => (this.linking = false));
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
    this.linked.clear();
  }
}
