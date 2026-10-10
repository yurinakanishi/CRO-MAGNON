import * as THREE from 'three';

/** A temporary loss of the WebGL context, as browsers report driver resets, GPU
 * memory pressure or a long-backgrounded tab. Three.js (r185) keeps its listeners
 * on the canvas: on loss it stops drawing; on restore it rebuilds its GL state
 * and uploads every retained geometry, texture and program again on first use. */
export const CONTEXT_RECOVERY = Object.freeze({
  /** Visible waiting before a reload is offered; hidden time never counts. */
  visibleWaitSeconds: 10,
  /** One frame adds at most this much: a stall or a resumed tab is not waiting. */
  maxFrameSeconds: 0.25,
});

export type ContextEvent = 'lost' | 'restored' | 'stalled';

/** Lost/restored bookkeeping with a bounded wait that only visible frames advance. */
export class GraphicsContextState {
  lost = false;
  losses = 0;
  restores = 0;
  /** The visible wait ran out during the current loss. */
  stalled = false;
  private waited = 0;
  private lastFrame: number | null = null;

  /** The context was lost; false when it already was. */
  lose(): boolean {
    if (this.lost) return false;
    this.lost = true;
    this.losses++;
    this.stalled = false;
    this.waited = 0;
    this.lastFrame = null;
    return true;
  }
  /** The context came back; false when it was not lost. */
  restore(): boolean {
    if (!this.lost) return false;
    this.lost = false;
    this.restores++;
    this.stalled = false;
    this.waited = 0;
    this.lastFrame = null;
    return true;
  }
  /** One animation frame (ms) during a loss. True exactly once, when the visible
   * wait runs out. A hidden page and the gap after it add nothing. */
  frame(now: number, hidden: boolean): boolean {
    if (!this.lost || this.stalled) return false;
    if (hidden) {
      this.lastFrame = null;
      return false;
    }
    if (this.lastFrame !== null)
      this.waited += Math.min(
        CONTEXT_RECOVERY.maxFrameSeconds,
        Math.max(0, (now - this.lastFrame) / 1000),
      );
    this.lastFrame = now;
    if (this.waited < CONTEXT_RECOVERY.visibleWaitSeconds) return false;
    this.stalled = true;
    return true;
  }
  /** Visible seconds waited during the current loss (diagnostics). */
  get waitedSeconds() {
    return this.waited;
  }
}

type Program = { isReady(): boolean | null };

/** renderer.compileAsync() without its lost-context hang. Programs are compiled
 * now; the wait ends when they are ready, or when the context is lost (polling a
 * lost context never completes) or replaced by a restore, after which programs
 * are compiled again on first use. */
export function compileScene(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Object3D,
  camera: THREE.Camera,
): Promise<void> {
  const gl = renderer.getContext();
  if (gl.isContextLost()) return Promise.resolve();
  const materials = renderer.compile(scene, camera),
    properties = renderer.properties;
  return new Promise((resolve) => {
    const check = () => {
      if (gl.isContextLost() || renderer.properties !== properties) {
        resolve();
        return;
      }
      for (const material of materials) {
        const program = (properties.get(material) as { currentProgram?: Program }).currentProgram;
        if (!program || program.isReady()) materials.delete(material);
      }
      if (materials.size) setTimeout(check, 10);
      else resolve();
    };
    // Without parallel compilation, give the driver a moment as Three does.
    if (renderer.extensions.has('KHR_parallel_shader_compile')) check();
    else setTimeout(check, 10);
  });
}

/** The CPU objects whose GPU allocations Three releases through 'dispose', and
 * the materials whose programs bind further textures (programUniforms()). */
export type GpuResources = {
  geometries: Set<THREE.BufferGeometry>;
  textures: Set<THREE.Texture>;
  targets: Set<THREE.RenderTarget>;
  instances: Set<THREE.InstancedMesh>;
  materials: Set<THREE.Material>;
};

type Flags = Record<string, unknown>;

/** Values that never hold a GPU resource and are met by the thousand. */
const LEAF_FLAGS = [
  'isVector2',
  'isVector3',
  'isVector4',
  'isQuaternion',
  'isEuler',
  'isMatrix3',
  'isMatrix4',
  'isColor',
  'isBox3',
  'isSphere',
  'isPlane',
  'isBufferAttribute',
  'isInterleavedBufferAttribute',
  'isWebGLRenderer',
];

const leaf = (value: object) =>
  ArrayBuffer.isView(value) ||
  value instanceof ArrayBuffer ||
  value === globalThis ||
  (typeof Node !== 'undefined' && value instanceof Node) ||
  value instanceof THREE.AnimationMixer ||
  value instanceof THREE.AnimationAction ||
  value instanceof THREE.AnimationClip ||
  LEAF_FLAGS.some((flag) => (value as Flags)[flag]);

/** A parsed model: parseEmbeddedGLB()'s RuntimeGLTF, marked `isRuntimeGLTF`, or a
 * GLTFLoader result, recognised by its parser. Everything it owns hangs from its
 * scene graphs, cameras and userData. A GLTFLoader result's parser (the GLB's JSON
 * and binary chunk and the load caches, which also repeat textures retired before
 * any draw) is not walked. Another owner with a `scene` or a `parser` field is
 * walked whole like any object. */
function isParsedModel(flags: Flags) {
  const scene = flags.scene as Flags | undefined,
    parser = flags.parser as Flags | undefined;
  if (!scene?.isObject3D || !Array.isArray(flags.scenes)) return false;
  return (
    flags.isRuntimeGLTF === true ||
    (typeof parser?.getDependency === 'function' && parser.associations instanceof Map)
  );
}

/** Every geometry, texture (bone textures included), render target and instanced
 * mesh reachable from `roots`: through scene graphs and materials (their uniforms
 * too), and through the owners' own fields, maps, sets and arrays, so templates,
 * detached levels, pools and textures that shaders receive in onBeforeCompile are
 * found where their owners keep them. A parsed model contributes every field but a
 * parser (isParsedModel). Closures cannot be walked: an owner keeps what it draws
 * in a field. */
export function collectGpuResources(roots: Iterable<unknown>): GpuResources {
  const found: GpuResources = {
    geometries: new Set(),
    textures: new Set(),
    targets: new Set(),
    instances: new Set(),
    materials: new Set(),
  };
  const seen = new Set<object>(),
    stack: object[] = [];
  const visit = (value: unknown) => {
    if (typeof value === 'object' && value !== null && !seen.has(value)) stack.push(value);
  };
  for (const root of roots) visit(root);
  for (let value = stack.pop(); value; value = stack.pop()) {
    if (seen.has(value)) continue;
    seen.add(value);
    const flags = value as Flags;
    if (flags.isTexture) found.textures.add(value as THREE.Texture);
    else if (flags.isBufferGeometry) found.geometries.add(value as THREE.BufferGeometry);
    else if (flags.isRenderTarget) found.targets.add(value as THREE.RenderTarget);
    else if (value instanceof THREE.Skeleton) {
      if (value.boneTexture) found.textures.add(value.boneTexture);
    } else if (isParsedModel(flags)) {
      for (const key of Object.keys(value)) if (key !== 'parser') visit(flags[key]);
    } else if (value instanceof Map)
      for (const [key, item] of value) {
        visit(key);
        visit(item);
      }
    else if (value instanceof Set || Array.isArray(value)) for (const item of value) visit(item);
    else if (!leaf(value)) {
      if (flags.isInstancedMesh) found.instances.add(value as THREE.InstancedMesh);
      if (flags.isMaterial) found.materials.add(value as THREE.Material);
      for (const key of Object.keys(value)) visit(flags[key]);
    }
  }
  return found;
}

type Uniforms = Record<string, { value?: unknown } | undefined>;

/** The uniform values of the program the renderer prepared for `material` in its
 * current context, if any. Three r185 keeps them in its per-context properties
 * (WebGLRenderer.js getProgram: `materialProperties.uniforms = parameters.uniforms`,
 * the object onBeforeCompile receives as `shader.uniforms`). Besides the
 * material's own maps they hold the textures handed to shaders in onBeforeCompile
 * and those the renderer assigns itself. Reading never adds an entry. */
function programUniforms(renderer: THREE.WebGLRenderer, material: THREE.Material) {
  if (!renderer.properties.has(material)) return undefined;
  return (renderer.properties.get(material) as { uniforms?: Uniforms }).uniforms;
}

const isTexture = (value: unknown): value is THREE.Texture =>
  !!(value as Flags | null | undefined)?.isTexture;

/** A resource Three creates and owns itself (recordEngineResources). */
export type EngineResource = THREE.Texture | THREE.BufferGeometry;

/** Three r185's own resources that a game never holds: module-level singletons
 * shared by every renderer, outliving each context. Every upload still adds a
 * 'dispose' listener of the uploading context's manager, so their owner records
 * them here and releases them at each loss and at its shutdown; otherwise each
 * lost context would leave one more listener (and its whole texture or geometry
 * manager) on the singleton.
 * - 'sprite-quad': the geometry every Sprite shares (Sprite.js).
 * - 'dfg-lut': the DFG lookup table of DFGLUTData.js getDFGLUT(), which
 *   WebGLRenderer.setProgram assigns to the `dfgLUT` uniform of every material
 *   with environment uniforms (WebGLRenderer.js 2700-2705, UniformsLib.envmap);
 *   it is reached through the program of such a material the renderer prepared.
 * Engine-version specific by nature: the context tests pin it to the installed r185. */
export function recordEngineResources(
  renderer: THREE.WebGLRenderer,
  materials: Iterable<THREE.Material>,
  record: Map<string, EngineResource>,
) {
  if (!record.has('sprite-quad')) record.set('sprite-quad', new THREE.Sprite().geometry);
  if (record.has('dfg-lut')) return record;
  for (const material of materials) {
    const lut = programUniforms(renderer, material)?.dfgLUT?.value;
    if (isTexture(lut)) {
      record.set('dfg-lut', lut);
      break;
    }
  }
  return record;
}

/** What releaseLostContext() released, the engine resources recorded so far,
 * and the allocations Three still counts for the lost context afterwards: zero
 * when every holder was reached. */
export type ContextRelease = {
  geometries: number;
  textures: number;
  targets: number;
  instances: number;
  engine: string[];
  unreleased: { geometries: number; textures: number };
  milliseconds: number;
};

/** Three r185 frees an uploaded texture, geometry (with its morph texture and
 * vertex arrays), render target or instanced mesh through 'dispose' listeners
 * bound to the context that uploaded it. A restore (initGLContext) builds new
 * texture, geometry and object managers without removing those listeners, so a
 * later dispose() runs them and deletes a handle of the lost context: WebKit
 * reports INVALID_OPERATION "delete: object does not belong to this context".
 * (Material listeners belong to the renderer itself and stay current.)
 *
 * Disposing, while the context is lost, every resource the roots hold, every
 * texture their materials' programs bound and the engine's own resources
 * (`engine`, recorded here) runs those listeners while each GL delete is a
 * silent no-op. Only GPU bookkeeping goes: images, attribute arrays, bone
 * matrices and the objects themselves stay, and Three uploads them into the
 * restored context on first use. Nothing happens unless the context is lost. */
export function releaseLostContext(
  renderer: THREE.WebGLRenderer,
  roots: Iterable<unknown>,
  engine = new Map<string, EngineResource>(),
): ContextRelease | null {
  if (!renderer.getContext().isContextLost()) return null;
  const started = performance.now(),
    found = collectGpuResources(roots);
  // The lost context's programs still name what they bound, the engine's own included.
  recordEngineResources(renderer, found.materials, engine);
  for (const resource of engine.values())
    if (isTexture(resource)) found.textures.add(resource);
    else found.geometries.add(resource);
  for (const material of found.materials)
    for (const uniform of Object.values(programUniforms(renderer, material) ?? {}))
      for (const value of [uniform?.value].flat()) if (isTexture(value)) found.textures.add(value);
  // Only the GPU event: InstancedMesh.dispose() would also drop its morph texture.
  for (const mesh of found.instances) mesh.dispatchEvent({ type: 'dispose' });
  for (const target of found.targets) target.dispose();
  for (const geometry of found.geometries) geometry.dispose();
  for (const texture of found.textures) texture.dispose();
  const { geometries, textures } = renderer.info.memory;
  return {
    geometries: found.geometries.size,
    textures: found.textures.size,
    targets: found.targets.size,
    instances: found.instances.size,
    engine: [...engine.keys()],
    unreleased: { geometries, textures },
    milliseconds: Math.round(performance.now() - started),
  };
}
