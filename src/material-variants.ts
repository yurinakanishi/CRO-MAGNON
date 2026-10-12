import * as THREE from 'three';

// Three r185 keeps one current program per material and looks it up again (WebGLRenderer
// setProgram → getProgram → WebGLPrograms.getParameters) whenever a draw needs another one: the
// material changed (its version), or the object differs from the last one it drew in a part of
// the program, such as instancing. A material shared by instanced and plain meshes, or drawn in
// Three's two transparent passes, therefore repeats that lookup on every frame. The variants
// below give each draw a material whose program stays current; they draw exactly as before.

/** A copy of `source` that draws as it does. Material.clone() keeps every value and texture
 * (by reference) but drops the hooks code assigns, each own function (onBeforeCompile,
 * customProgramCacheKey, …), which the copy takes over; it shares the userData object, which
 * those hooks may read, and copies the defines. */
export function materialCopy<T extends THREE.Material>(source: T): T {
  const copy = source.clone();
  const hooks = source as unknown as Record<string, unknown>,
    target = copy as unknown as Record<string, unknown>;
  for (const key of Object.keys(hooks))
    if (typeof hooks[key] === 'function') target[key] = hooks[key];
  copy.userData = source.userData;
  if (source.defines) copy.defines = { ...source.defines };
  return copy;
}

/** Copies that live as long as their source: disposing the source disposes them. */
function releasedWith(source: THREE.Material, copies: THREE.Material[], forget: () => void) {
  const release = () => {
    source.removeEventListener('dispose', release);
    forget();
    for (const copy of copies) copy.dispose();
  };
  source.addEventListener('dispose', release);
}

const instanced = new WeakMap<THREE.Material, THREE.Material>();

/** The material an InstancedMesh draws `source` with: one copy per source material, shared by
 * every instanced user and released with the source. Plain meshes keep the source, so neither
 * material changes program between the instanced and the plain draws of a frame. */
export function instancedMaterial<T extends THREE.Material>(source: T): T;
export function instancedMaterial(
  source: THREE.Material | THREE.Material[],
): THREE.Material | THREE.Material[];
export function instancedMaterial(
  source: THREE.Material | THREE.Material[],
): THREE.Material | THREE.Material[] {
  if (Array.isArray(source)) return source.map((material) => instancedMaterial(material));
  let copy = instanced.get(source);
  if (!copy) {
    const made = materialCopy(source);
    instanced.set(source, made);
    releasedWith(source, [made], () => instanced.delete(source));
    copy = made;
  }
  return copy;
}

const sides = new WeakMap<THREE.Material, [THREE.Material, THREE.Material]>();

/** Whether Three draws `material` in two passes (WebGLRenderer.renderObject). */
export function drawnInTwoPasses(material: THREE.Material) {
  return material.transparent && material.side === THREE.DoubleSide && !material.forceSinglePass;
}

/** Three draws a transparent double-sided material in two passes, its back faces and then its
 * front faces, and marks the material changed before each (WebGLRenderer.renderObject), so each
 * such draw looks its program up twice. The mesh instead draws the same two passes as two groups
 * over its whole geometry: the back faces with a BackSide copy, then the front faces with a
 * FrontSide copy. The programs, uniforms and order are Three's own (both groups are one object at
 * one depth, kept in order by the stable sort of the transparent list), and renderer.compile()
 * prepares both. The pair is shared by every mesh of `mesh.material` and released with it. The
 * geometry must be the mesh's own, or shared only with meshes split the same way. */
export function drawSidesInTurn(mesh: THREE.Mesh) {
  const material = mesh.material;
  if (Array.isArray(material) || !drawnInTwoPasses(material))
    throw new Error(`${mesh.name || 'Mesh'} is not drawn in Three's two transparent passes`);
  const geometry = mesh.geometry,
    count = geometry.index ? geometry.index.count : geometry.attributes.position.count,
    groups = geometry.groups;
  const split =
    groups.length === 2 &&
    groups.every(
      (group, index) => group.start === 0 && group.count === count && group.materialIndex === index,
    );
  if (!split) {
    if (groups.length) throw new Error(`${mesh.name || 'Mesh'}: its geometry has other groups`);
    geometry.addGroup(0, count, 0);
    geometry.addGroup(0, count, 1);
  }
  let pair = sides.get(material);
  if (!pair) {
    const made: [THREE.Material, THREE.Material] = [materialCopy(material), materialCopy(material)];
    made[0].side = THREE.BackSide;
    made[1].side = THREE.FrontSide;
    sides.set(material, made);
    releasedWith(material, made, () => sides.delete(material));
    pair = made;
  }
  mesh.material = pair;
  return pair;
}
