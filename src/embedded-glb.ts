import * as THREE from 'three';
import { GLTFLoader, type GLTF, type GLTFParser } from 'three/addons/loaders/GLTFLoader.js';
// The meshopt decoder three r185 ships with its GLTFLoader and tests it against
// (examples/jsm/libs/meshopt_decoder.module.js, "Built from meshoptimizer 1.1"),
// published as /vendor/addons/libs/ by prepare-vendor. The offline asset tools pin
// the npm package meshoptimizer 1.1.1 instead; the runtime never loads that package.
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { downloadVerifiedAsset, type AssetDownload } from './asset-download.js';
import { sha256 } from './asset-hash.js';
import { isTexture } from './three-types.js';

const GLB_MAGIC = 0x46546c67,
  CHUNK_JSON = 0x4e4f534a,
  CHUNK_BIN = 0x004e4942;
const MESHOPT = ['EXT_meshopt_compression', 'KHR_meshopt_compression'];
// GLTFLoader r185 asks its texture plugins in registration order (GLTFLoader.js
// 157-173): KHR_texture_basisu, which needs a KTX2 loader this game never sets,
// then these two; a texture none of them claims uses its own `source` (3212).
const IMAGE_EXTENSIONS = ['EXT_texture_webp', 'EXT_texture_avif'];

type GltfJson = Record<string, any>;
type Part = THREE.Object3D & {
  geometry?: THREE.BufferGeometry;
  material?: THREE.Material | THREE.Material[];
  skeleton?: THREE.Skeleton;
};
type RuntimeFields = 'scene' | 'scenes' | 'animations' | 'cameras' | 'asset' | 'userData';
/** A model as the game keeps it once parseEmbeddedGLB() returns: GLTFLoader's own
 * scene graphs, clips, cameras and metadata, unchanged, without its parser. The
 * parser holds the GLB's JSON and binary chunk, the encoded images and the load
 * caches, and nothing reads it after loading. `isRuntimeGLTF` tells collectors
 * what the object is (context-recovery.ts). */
export type RuntimeGLTF = Pick<GLTF, RuntimeFields> & { readonly isRuntimeGLTF: true };
type SceneGraphs = { scene?: THREE.Object3D; scenes?: THREE.Object3D[] };
/** One parsed model of a template: its full model, LODs and any later variant. */
export type CohortModel = SceneGraphs | null | undefined;
/** What one parse asked for, recorded through GLTFLoader's public hooks. */
type ParseRecord = {
  parser?: GLTFParser;
  /** Material indices the parser was asked for. */
  materials: Set<number>;
  /** Object URLs GLTFLoader made for the embedded images. */
  blobs: Set<string>;
};

const failure = (label: string, message: string) => new Error(`${label}: ${message}`);
const isIndex = (value: unknown, length: number): value is number =>
  Number.isInteger(value) && (value as number) >= 0 && (value as number) < length;
const isMaterial = (value: unknown): value is THREE.Material =>
  !!value && (value as THREE.Material).isMaterial === true;
const materialsOf = (node: THREE.Object3D) =>
  [(node as Part).material].flat().filter(Boolean) as THREE.Material[];
const texturesOf = (material: THREE.Material) => Object.values(material).filter(isTexture);

/** A model's scene graphs: GLTFLoader's `scenes`, `scene` among them. */
function scenesOf(model: CohortModel) {
  const scenes = new Set<THREE.Object3D>();
  for (const scene of [model?.scene, ...(model?.scenes ?? [])]) if (scene) scenes.add(scene);
  return scenes;
}

/** The value of a request, or null if it threw or rejected. */
async function settled(request: () => unknown) {
  try {
    return await request();
  } catch {
    return null;
  }
}

function usesMeshopt(json: GltfJson) {
  const views: GltfJson[] = json.bufferViews ?? [];
  for (const name of MESHOPT)
    if (json.extensionsUsed?.includes(name) || views.some((view) => view?.extensions?.[name]))
      return true;
  return false;
}

/** A GLB 2.0 container: its JSON and its BIN chunk (empty when there is none),
 * every chunk range checked. Chunks after the BIN chunk are ignored, as GLTFLoader
 * ignores them. */
export function readGlb(bytes: ArrayBuffer, label = 'GLB'): { json: GltfJson; bin: Uint8Array } {
  if (bytes.byteLength < 20) throw failure(label, 'shorter than a GLB header');
  const view = new DataView(bytes);
  if (view.getUint32(0, true) !== GLB_MAGIC) throw failure(label, 'missing the glTF magic');
  if (view.getUint32(4, true) !== 2)
    throw failure(label, `unsupported GLB version ${view.getUint32(4, true)}`);
  if (view.getUint32(8, true) !== bytes.byteLength)
    throw failure(label, 'its header length does not match the file');
  let json: unknown = null,
    bin = new Uint8Array(0);
  for (let offset = 12, chunk = 0; offset < bytes.byteLength; chunk++) {
    if (offset + 8 > bytes.byteLength)
      throw failure(label, `truncated chunk header at byte ${offset}`);
    const length = view.getUint32(offset, true),
      type = view.getUint32(offset + 4, true),
      start = offset + 8;
    if (start + length > bytes.byteLength) throw failure(label, `chunk ${chunk} exceeds the file`);
    if (chunk === 0) {
      if (type !== CHUNK_JSON) throw failure(label, 'its first chunk is not JSON');
      try {
        json = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, start, length)));
      } catch (error) {
        throw failure(label, `invalid JSON chunk (${(error as Error).message})`);
      }
    } else if (chunk === 1 && type === CHUNK_BIN) bin = new Uint8Array(bytes, start, length);
    offset = start + length;
  }
  if (!json || typeof json !== 'object' || Array.isArray(json))
    throw failure(label, 'its JSON chunk is not an object');
  return { json: json as GltfJson, bin };
}

/** The image GLTFLoader r185 decodes for texture `index`: EXT_texture_webp's
 * source, else EXT_texture_avif's, else the texture's own `source`. A texture
 * that requires KTX2 cannot load here. */
export function selectedImage(json: GltfJson, index: number, label = 'GLB'): number {
  const texture = json.textures?.[index],
    images = json.images?.length ?? 0,
    where = `texture ${index}`;
  if (!texture || typeof texture !== 'object') throw failure(label, `${where} is missing`);
  if (
    texture.extensions?.KHR_texture_basisu &&
    json.extensionsRequired?.includes('KHR_texture_basisu')
  )
    throw failure(label, `${where} requires KTX2 textures, which this game does not load`);
  for (const name of IMAGE_EXTENSIONS) {
    const extension = texture.extensions?.[name];
    if (!extension) continue;
    if (!isIndex(extension.source, images))
      throw failure(label, `${where} ${name} source is not an image`);
    return extension.source;
  }
  if (!isIndex(texture.source, images)) throw failure(label, `${where} has no image source`);
  return texture.source;
}

/** The encoded bytes GLTFLoader decodes for image `index`: a base64 data: URI or
 * an uncompressed view of the GLB's BIN chunk. Anything else (an external URI, a
 * meshopt-compressed or fallback view, a range outside the chunk) fails here
 * rather than hashing bytes that are not that image. */
function imageBytes(json: GltfJson, bin: Uint8Array, index: number, label: string) {
  const image = json.images?.[index],
    where = `image ${index}`;
  if (!image || typeof image !== 'object') throw failure(label, `${where} is missing`);
  if (image.uri !== undefined) {
    const data = /^data:[^,]*;base64,([A-Za-z0-9+/=\s]*)$/.exec(String(image.uri));
    if (!data) throw failure(label, `${where}: GLB must embed its resources`);
    return Uint8Array.from(atob(data[1]), (character) => character.charCodeAt(0));
  }
  const views = json.bufferViews ?? [];
  if (!isIndex(image.bufferView, views.length))
    throw failure(label, `${where} has no valid buffer view`);
  const view = views[image.bufferView],
    buffer = json.buffers?.[0];
  if (MESHOPT.some((name) => view?.extensions?.[name]))
    throw failure(label, `${where} is stored in a compressed buffer view`);
  if (view?.buffer !== 0 || !buffer || buffer.uri !== undefined)
    throw failure(label, `${where} is not stored in the GLB binary chunk`);
  const offset = view.byteOffset ?? 0,
    length = view.byteLength;
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(length) ||
    length < 1 ||
    offset + length > Math.min(bin.length, buffer.byteLength)
  )
    throw failure(label, `${where} range ${offset}+${length} is outside the binary chunk`);
  return bin.subarray(offset, offset + length);
}

/** Nothing in the file can make GLTFLoader fetch: buffer 0 is the BIN chunk and
 * every other buffer is a data: URI or a meshopt fallback without data; every
 * image is embedded (imageBytes). */
function checkEmbedded(json: GltfJson, bin: Uint8Array, label: string) {
  (json.buffers ?? []).forEach((buffer, index) => {
    if (!buffer || typeof buffer !== 'object') throw failure(label, `buffer ${index} is missing`);
    if (buffer.uri !== undefined) {
      if (!String(buffer.uri).startsWith('data:'))
        throw failure(label, `buffer ${index}: GLB must embed its resources`);
    } else if (index === 0) {
      if (!(buffer.byteLength <= bin.length))
        throw failure(label, 'buffer 0 is longer than the GLB binary chunk');
    } else if (!MESHOPT.some((name) => buffer.extensions?.[name]?.fallback === true))
      throw failure(label, `buffer ${index} has neither data nor a meshopt fallback`);
  });
  (json.images ?? []).forEach((_, index) => imageBytes(json, bin, index, label));
}

/** A GLTFLoader plugin that records its parser and every material it is asked
 * for. In three r185 GLTFParser.assignTexture, called only while a material
 * loads, is what requests textures, and no built-in plugin loads materials, so
 * each material request reaches this plugin first; it answers null and the
 * parser loads the material itself. */
const recordParse = (parse: ParseRecord) => (parser: GLTFParser) => {
  parse.parser = parser;
  return {
    name: 'CRO_parse_record',
    loadMaterial(index: number) {
      parse.materials.add(index);
      return null;
    },
  };
};

/** Texture indices a glTF material definition refers to: the `index` of each
 * core or extension textureInfo in it. */
function textureIndices(definition: unknown, found = new Set<number>()) {
  if (definition && typeof definition === 'object')
    for (const [key, value] of Object.entries(definition))
      if (key === 'index' && Number.isInteger(value)) found.add(value as number);
      else if (key !== 'extras') textureIndices(value, found);
  return found;
}

/** Release everything one parse made, once, when the parse failed or its result
 * is refused. A rejected parse leaves its other requests running, and images may
 * still be decoding. So this first waits for each material the parser was asked
 * for and each texture those materials name; the parser caches both requests,
 * so nothing is loaded twice. Then it disposes the geometry, skeletons,
 * materials and textures reachable from them, from the parser's associations
 * and from `models`, closes each decoded image and revokes the parse's object
 * URLs, which GLTFLoader revokes only for images that decoded. A mesh whose
 * geometry never resolved never reached the GPU and is left to the collector. */
async function releaseParse(parse: ParseRecord, models: CohortModel[] = []) {
  const { parser } = parse;
  // GLTFLoader makes its parser before it loads anything.
  if (!parser) return;
  const requests = new Map<string, Promise<unknown>>();
  const request = (type: 'material' | 'texture', index: number) => {
    const key = `${type}:${index}`;
    if (!requests.has(key))
      requests.set(
        key,
        settled(() => parser.getDependency(type, index)),
      );
  };
  // Again until nothing new was asked for while waiting.
  for (let seen = -1; seen !== requests.size;) {
    seen = requests.size;
    for (const index of parse.materials) {
      request('material', index);
      for (const texture of textureIndices(parser.json.materials?.[index]))
        request('texture', texture);
    }
    await Promise.all(requests.values());
  }
  const resources = new Set<{ dispose(): void }>(),
    textures = new Set<THREE.Texture>();
  const material = (value: THREE.Material) => {
    resources.add(value);
    for (const texture of texturesOf(value)) textures.add(texture);
  };
  const part = (node: THREE.Object3D) => {
    const { geometry, skeleton } = node as Part;
    if (geometry) resources.add(geometry);
    if (skeleton) resources.add(skeleton);
    materialsOf(node).forEach(material);
  };
  const made = await Promise.all(requests.values());
  for (const value of [...made, ...parser.associations.keys()])
    if (isTexture(value)) textures.add(value);
    else if (isMaterial(value)) material(value);
    else if ((value as THREE.Object3D | null)?.isObject3D) part(value as THREE.Object3D);
  for (const model of models) for (const scene of scenesOf(model)) scene.traverse(part);
  for (const resource of resources) resource.dispose();
  const images = new Set<{ close?: () => void } | null | undefined>();
  for (const texture of textures) {
    texture.dispose();
    images.add(texture.source?.data);
  }
  for (const image of images) image?.close?.();
  for (const url of parse.blobs) URL.revokeObjectURL(url);
}

/** Parse verified GLB bytes with the one loader configuration every runtime model
 * uses. The bundled meshopt decoder is set before parsing; a compressed model on
 * a browser that cannot run it fails, never reading fallback data. External
 * resources are refused, an embedded image that does not decode fails the parse
 * (GLTFLoader alone would leave the material without it), and every texture
 * records `userData.embeddedSha256`: the SHA-256 of the encoded image GLTFLoader
 * actually selected for it (selectedImage), the identity coalesceTextures() uses.
 * A parse that fails releases what it made (releaseParse) before rejecting; one
 * that succeeds returns only what the game keeps (RuntimeGLTF). */
export async function parseEmbeddedGLB(bytes: ArrayBuffer, label = 'GLB'): Promise<RuntimeGLTF> {
  const { json, bin } = readGlb(bytes, label);
  checkEmbedded(json, bin, label);
  const hashes = new Map<number, Promise<string>>(),
    byImage = new Map<number, Promise<string>>();
  (json.textures ?? []).forEach((_, index) => {
    const image = selectedImage(json, index, label);
    if (!byImage.has(image)) byImage.set(image, sha256(imageBytes(json, bin, image, label)));
    hashes.set(index, byImage.get(image)!);
  });
  await Promise.all(byImage.values());
  if (usesMeshopt(json)) {
    if (!MeshoptDecoder.supported)
      throw failure(label, 'its meshopt compression cannot be decoded without WebAssembly');
    await MeshoptDecoder.ready;
  }
  const parse: ParseRecord = { materials: new Set(), blobs: new Set() },
    undecoded: string[] = [];
  const manager = new THREE.LoadingManager(undefined, undefined, (url) => undecoded.push(url));
  manager.setURLModifier((url) => {
    if (url.startsWith('blob:')) parse.blobs.add(url);
    else if (!url.startsWith('data:')) throw new Error('GLB must embed its resources');
    return url;
  });
  const loader = new GLTFLoader(manager).setMeshoptDecoder(MeshoptDecoder);
  loader.register(recordParse(parse));
  let gltf: GLTF;
  try {
    gltf = await loader.parseAsync(bytes, '');
  } catch (error) {
    await releaseParse(parse);
    throw error;
  }
  if (undecoded.length) {
    await releaseParse(parse, [gltf]);
    throw failure(label, `${undecoded.length} embedded image(s) could not be decoded`);
  }
  for (const [object, reference] of gltf.parser.associations)
    if (isTexture(object) && reference.textures !== undefined) {
      const hash = hashes.get(reference.textures);
      if (hash) object.userData.embeddedSha256 = await hash;
    }
  // The same objects, unchanged; the parser and everything only it holds are left behind.
  const { scene, scenes, animations, cameras, asset, userData } = gltf;
  return { isRuntimeGLTF: true, scene, scenes, animations, cameras, asset, userData };
}

/** A verified model: its bytes downloaded and checked against the record's length
 * and SHA-256 (asset-download.ts), then parsed by parseEmbeddedGLB(). */
export async function loadVerifiedGLB(record: AssetDownload): Promise<RuntimeGLTF> {
  return parseEmbeddedGLB(await downloadVerifiedAsset(record), record.url);
}

// Texture kinds whose upload differs from an embedded image's.
const SPECIAL_TEXTURES = [
  'isDataTexture',
  'isCompressedTexture',
  'isCubeTexture',
  'isCanvasTexture',
  'isVideoTexture',
  'isDepthTexture',
  'isFramebufferTexture',
  'isDataArrayTexture',
  'isData3DTexture',
  'isCompressedArrayTexture',
  'isRenderTargetTexture',
  'isExternalTexture',
];

/** Everything that decides the pixels a texture of one encoded image produces in
 * three r185: its upload (format, type, colour space, flip, premultiplication,
 * alignment, mipmap generation), its sampling (UV channel, mapping, wrapping,
 * filters, anisotropy, comparison) and its UV transform (offset, repeat, rotation
 * and centre, or the matrix itself when matrixAutoUpdate is off). Null for a
 * texture that is not a plain embedded image with a recorded identity. */
export function textureIdentity(texture: THREE.Texture): string | null {
  const hash = texture.userData?.embeddedSha256,
    flags = texture as unknown as Record<string, unknown>;
  if (typeof hash !== 'string' || !hash) return null;
  if (SPECIAL_TEXTURES.some((flag) => flags[flag]) || flags.onUpdate) return null;
  if ((flags.mipmaps as unknown[] | undefined)?.length) return null;
  return JSON.stringify([
    hash,
    texture.mapping,
    texture.channel,
    texture.wrapS,
    texture.wrapT,
    texture.magFilter,
    texture.minFilter,
    texture.anisotropy,
    texture.format,
    texture.internalFormat,
    texture.type,
    texture.colorSpace,
    texture.flipY,
    texture.premultiplyAlpha,
    texture.unpackAlignment,
    texture.generateMipmaps,
    flags.compareFunction ?? null,
    texture.offset.toArray(),
    texture.repeat.toArray(),
    texture.center.toArray(),
    texture.rotation,
    texture.matrixAutoUpdate,
    texture.matrixAutoUpdate ? null : texture.matrix.toArray(),
  ]);
}

/** Share textures within one template cohort: the models of a single template
 * that are disposed together (a full model and its LODs), never across templates
 * or providers. Where two textures have the same textureIdentity() the later
 * material slot takes the earlier texture; materials themselves (and their
 * normalScale or tangent handling) stay as loaded. A retired texture is disposed,
 * and its decoded image closed only if no texture left in the cohort still uses
 * it (GLTFLoader gives one image to every sampler of it).
 *
 * The first-seen texture of each identity is kept, so the call is repeatable: on
 * a cohort already coalesced nothing changes, and a cohort grown later lists its
 * earlier members first, keeping the textures their variants and instances
 * already use. Call it before a newly listed model gets variants of its own.
 * Returns the number of textures retired. */
export function coalesceTextures(models: Iterable<CohortModel>) {
  const materials = new Set<THREE.Material>();
  for (const model of models)
    for (const scene of scenesOf(model))
      scene.traverse((node) => {
        for (const material of materialsOf(node)) materials.add(material);
      });
  const kept = new Map<string, THREE.Texture>(),
    retired = new Set<THREE.Texture>();
  for (const material of materials)
    for (const [slot, texture] of Object.entries(material)) {
      if (!isTexture(texture)) continue;
      const identity = textureIdentity(texture);
      if (identity === null) continue;
      const shared = kept.get(identity);
      if (!shared) kept.set(identity, texture);
      else if (shared !== texture) {
        (material as unknown as Record<string, unknown>)[slot] = shared;
        retired.add(texture);
      }
    }
  if (!retired.size) return 0;
  const live = new Set<unknown>(),
    closed = new Set<unknown>();
  for (const material of materials)
    for (const texture of texturesOf(material)) live.add(texture.source?.data);
  for (const texture of retired) {
    texture.dispose();
    const image = texture.source?.data as { close?: () => void } | null | undefined;
    if (image && !live.has(image) && !closed.has(image)) {
      closed.add(image);
      image.close?.();
    }
  }
  return retired.size;
}

/** Release a template cohort once: its models (all their scenes) may share
 * geometry, materials, skeletons and textures, and textures may share one decoded
 * image. Texture dispose() frees only the GPU copy, so each image is closed here
 * as its last owner. */
export function disposeModels(models: Iterable<CohortModel>) {
  const resources = new Set<{ dispose(): void }>(),
    textures = new Set<THREE.Texture>();
  for (const model of models)
    for (const scene of scenesOf(model))
      scene.traverse((node) => {
        const part = node as Part;
        if (part.geometry) resources.add(part.geometry);
        if (part.skeleton) resources.add(part.skeleton);
        for (const material of materialsOf(node)) {
          resources.add(material);
          for (const texture of texturesOf(material)) textures.add(texture);
        }
      });
  for (const resource of resources) resource.dispose();
  const images = new Set<{ close?: () => void } | null | undefined>();
  for (const texture of textures) {
    texture.dispose();
    images.add(texture.source?.data);
  }
  for (const image of images) image?.close?.();
}
