// Register a NEW remake asset (one that replaces code-built primitives, so it has no earlier delivery) in the
// game delivery: copies the GLB to public/models/<key>/model-c2.glb, adds a world-assets.json entry and a per-model
// asset.json, measuring the delivered geometry. Refuses to touch an existing key (use adopt_world_asset.mjs).
// node scripts/remake/adopt_new_asset.mjs <spec.json>
// spec: { key, name, kind, glb, reference, dense, processReport, replaces, placement, notes: [..], onDemand? }
import { readFile, writeFile, copyFile, mkdir, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import * as THREE from 'three';
import { geometryScene } from '../measure-collision-bounds.mjs';

const spec = JSON.parse(await readFile(process.argv[2], 'utf8'));
const root = path.resolve(import.meta.dirname, '../..');
const hash = (b) => createHash('sha256').update(b).digest('hex');
const exists = async (p) => access(p).then(() => true, () => false);
const manifestPath = path.join(root, 'public/models/world-assets.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
if (manifest.assets.some((a) => a.modelKey === spec.key)) throw new Error(`${spec.key} already exists`);
const dir = path.join(root, 'public/models', spec.key);
await mkdir(dir, { recursive: true });
const target = path.join(dir, 'model-c2.glb');
const bytes = await readFile(spec.glb);
if (await exists(target)) {
  if (hash(await readFile(target)) !== hash(bytes)) throw new Error(`Refusing to overwrite ${target}`);
} else await copyFile(spec.glb, target);
const doc = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
let triangles = 0;
for (const m of doc.meshes ?? [])
  for (const p of m.primitives) triangles += doc.accessors[p.indices].count / 3;
const gltf = await geometryScene(target);
gltf.scene.updateMatrixWorld(true);
const box = new THREE.Box3().setFromObject(gltf.scene, true);
const size = box.getSize(new THREE.Vector3());
const entry = {
  modelKey: spec.key,
  name: spec.name,
  kind: spec.kind,
  candidate: 2,
  revision: `c2-${path.basename(path.dirname(spec.glb))}`,
  status: 'remake-candidate-2-integrated',
  url: `/models/${spec.key}/model-c2.glb`,
  sha256: hash(bytes),
  bytes: bytes.length,
  triangles,
  upAxis: 'Y',
  forwardAxis: '+Z',
  heightMetres: Number(size.y.toFixed(4)),
  widthMetres: Number(Math.max(size.x, size.z).toFixed(4)),
  placement: { pivot: 'ground-centred', min: box.min.toArray(), max: box.max.toArray(), ...(spec.placement ?? {}) },
  clips: [],
  lods: [],
  notes: spec.notes ?? [],
  onDemand: spec.onDemand ?? true,
  replaces: spec.replaces,
  provenance: {
    provider: 'Claude Code (Opus 5.5)',
    claudeUsed: true,
    referenceGenerator: 'Codex CLI built-in image_gen (gpt-5.6-sol, medium)',
    referenceImage: spec.reference,
    referenceSha256: hash(await readFile(spec.reference)),
    reconstruction: 'Local TRELLIS-2 v0.8.1, res 1024, tex 1024, seed recorded in dense JSON',
    denseFile: spec.dense,
    denseSha256: hash(await readFile(spec.dense)),
    processReport: spec.processReport,
    pipeline: 'scripts/remake/ (trellis_queue.py, meshopt_reduce.mjs, xatlas_unwrap.py, remake_process.py); docs/asset-remake/PLAN.md',
    previousDelivery: null,
  },
};
manifest.assets.push(entry);
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
await writeFile(path.join(dir, 'asset.json'), JSON.stringify(entry, null, 2) + '\n');
console.log(JSON.stringify({ key: spec.key, url: entry.url, triangles, size: size.toArray(), bytes: bytes.length }));
