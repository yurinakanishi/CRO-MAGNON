import type * as THREE from 'three';
import type { AssetDownload } from './asset-download.js';
import type { RuntimeGLTF } from './embedded-glb.js';
import { isSkinnedMesh } from './three-types.js';

/** One level of a world template record: its full model or one of its LODs. A
 * packed level also names the glTF scene that holds it. */
export interface LevelRecord extends AssetDownload {
  scene?: number;
}
/** A world template record as the catalog lists it, LODs finest first. */
export interface TemplateRecord extends LevelRecord {
  modelKey: string;
  kind?: string;
  lods?: LevelRecord[];
}
/** How a template's levels are downloaded: one file per level, or one packed
 * file whose scene i is level i. */
export type TemplateLevels =
  { packed: false; files: LevelRecord[] } | { packed: true; file: LevelRecord; levels: number };

type Part = THREE.Object3D & {
  geometry?: THREE.BufferGeometry;
  material?: THREE.Material | THREE.Material[];
  isBone?: boolean;
};

// Animated actors keep one file per level: their clips, skeletons and grips are
// found by name, and GLTFLoader names objects uniquely across a whole file.
const ACTOR_KINDS = new Set(['quadruped', 'companion', 'enemy']);

const failure = (label: string, message: string) => new Error(`${label}: ${message}`);
const fileIdentity = (file: AssetDownload) =>
  JSON.stringify([
    file.url,
    file.sha256,
    file.bytes,
    Array.isArray(file.parts)
      ? file.parts.map((part) => [part?.url, part?.sha256, part?.bytes])
      : file.parts,
  ]);

/** The levels of a template record. Without any `scene` this is the ordinary
 * template: one verified file per level, loaded as before. A `scene` on any level
 * makes it packed, which holds only if every level names one, level i (the full
 * model 0, LOD i) names scene i, and every level names the same file: URL,
 * SHA-256, length and parts. Animated actor kinds are never packed. Anything else
 * is refused here, before anything is downloaded; nothing falls back to scene 0
 * or to separate files. */
export function templateLevels(asset: TemplateRecord): TemplateLevels {
  const records: LevelRecord[] = [asset, ...(asset.lods ?? [])],
    label = asset.modelKey;
  const named = records.filter((record) => record.scene !== undefined).length;
  if (!named) return { packed: false, files: records };
  if (named !== records.length)
    throw failure(
      label,
      `${named} of its ${records.length} levels name a scene; a packed template names one for every level`,
    );
  if (ACTOR_KINDS.has(asset.kind ?? ''))
    throw failure(label, `a ${asset.kind} cannot have packed levels`);
  const levels = new Map<number, number>();
  records.forEach((record, level) => {
    const scene = record.scene as number;
    if (!Number.isInteger(scene))
      throw failure(
        label,
        `level ${level} names scene ${JSON.stringify(scene)}, not a scene index`,
      );
    if (levels.has(scene))
      throw failure(label, `levels ${levels.get(scene)} and ${level} both name scene ${scene}`);
    levels.set(scene, level);
    if (scene !== level)
      throw failure(
        label,
        `level ${level} names scene ${scene}; packed level ${level} is scene ${level}`,
      );
    if (fileIdentity(record) !== fileIdentity(asset))
      throw failure(
        label,
        `level ${level} is not the file level 0 names (URL, SHA-256, length and parts must agree)`,
      );
  });
  return { packed: true, file: asset, levels: records.length };
}

/** Bytes a template's load downloads: each level's file, or a packed file once.
 * Per template; templates that happen to name the same file each count it. */
export function templateDownloadBytes(asset: TemplateRecord): number {
  const plan = templateLevels(asset),
    files = 'files' in plan ? plan.files : [plan.file];
  return files.reduce((sum, file) => sum + (file.bytes ?? 0), 0);
}

/** Refuse packed levels where a template is loaded one file per level (enemies)
 * or as its full model alone (equipment), rather than reading scene 0 for all. */
export function requireSeparateLevels(asset: TemplateRecord, use: string) {
  if ([asset, ...(asset.lods ?? [])].some((record) => record.scene !== undefined))
    throw failure(asset.modelKey, `${use} templates cannot have packed levels`);
}

/** Every level of one parsed packed file, as the per-level models a template
 * keeps: the parsed model with `scene` and `scenes` narrowed to that level's scene
 * graph. Together they hold each scene once, so coalescing and disposing them
 * covers the whole file once. Refused unless the file has exactly `levels`
 * scenes, distinct root graphs with scene 0 the default, each drawing something,
 * no animation, skin or bone, and no geometry or material shared between levels
 * (GLTFLoader r185 clones a node two scenes share, keeping its geometry and
 * materials). Textures may be shared: GLTFLoader gives one Texture to every use
 * of an image with the same sampler. The caller releases the parsed model whole
 * when this throws. */
export function packedLevels(model: RuntimeGLTF, levels: number, label: string): RuntimeGLTF[] {
  const scenes = model?.scenes;
  if (!Array.isArray(scenes) || scenes.length !== levels)
    throw failure(
      label,
      `has ${Array.isArray(scenes) ? scenes.length : 'no'} scenes for ${levels} packed levels`,
    );
  if (new Set(scenes).size !== levels || model.scene !== scenes[0])
    throw failure(label, 'its scenes must be distinct, with scene 0 the default');
  if (model.animations?.length) throw failure(label, 'packed levels cannot be animated');
  const owners = new Map<object, number>();
  const own = (resource: object, level: number, what: string) => {
    const owner = owners.get(resource) ?? level;
    if (owner !== level) throw failure(label, `scenes ${owner} and ${level} share ${what}`);
    owners.set(resource, level);
  };
  scenes.forEach((scene, level) => {
    if (!scene?.isObject3D || scene.parent)
      throw failure(label, `scene ${level} is not a root scene graph`);
    let drawn = 0;
    scene.traverse((node) => {
      const part = node as Part;
      if (isSkinnedMesh(part) || part.isBone)
        throw failure(label, `scene ${level} is skinned; packed levels are static`);
      if (!part.geometry) return;
      drawn++;
      own(part.geometry, level, 'geometry');
      for (const material of [part.material].flat())
        if (material) own(material, level, 'a material');
    });
    if (!drawn) throw failure(label, `scene ${level} draws nothing`);
  });
  return scenes.map((scene) => ({ ...model, scene, scenes: [scene] }));
}
