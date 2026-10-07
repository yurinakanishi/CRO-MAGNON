// Adopt a 2026-10 remake candidate into the game delivery without overwriting earlier files.
// node scripts/remake/adopt_world_asset.mjs <spec.json>
// spec: { key, candidate: 2, glb, lods: [{ glb, distanceMetres, purpose }], reference, dense, processReport,
//         rigReport?, clips?, locomotion?, notes: [..], placement?, extra?, provenance? (overrides) }
import { readFile, writeFile, copyFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import * as THREE from 'three';
import { geometryScene } from '../measure-collision-bounds.mjs';

const spec = JSON.parse(await readFile(process.argv[2], 'utf8'));
const root = path.resolve(import.meta.dirname, '../..');
const hash = (b) => createHash('sha256').update(b).digest('hex');
const sha = async (p) => hash(await readFile(p));
const exists = async (p) => access(p).then(() => true, () => false);
const key = spec.key;
const tag = `c${spec.candidate ?? 2}`;
const dir = path.join(root, 'public/models', key);

function glbInfo(bytes) {
  const doc = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
  let triangles = 0;
  for (const m of doc.meshes ?? [])
    for (const p of m.primitives)
      triangles += (p.indices !== undefined ? doc.accessors[p.indices].count : doc.accessors[p.attributes.POSITION].count) / 3;
  const clips = (doc.animations ?? []).map((a) => {
    let seconds = 0;
    for (const s of a.samplers) seconds = Math.max(seconds, doc.accessors[s.input].max?.[0] ?? 0);
    return { name: a.name, seconds, loop: a.name.endsWith('_Loop') };
  });
  return { triangles, clips, joints: doc.skins?.[0]?.joints.length ?? 0 };
}

async function deliver(src, name) {
  const target = path.join(dir, name);
  const bytes = await readFile(src);
  if (await exists(target)) {
    if (hash(await readFile(target)) !== hash(bytes)) throw new Error(`Refusing to overwrite ${target}`);
  } else await copyFile(src, target);
  return { url: `/models/${key}/${name}`, sha256: hash(bytes), bytes: bytes.length, ...glbInfo(bytes) };
}

const main = await deliver(spec.glb, `model-${tag}.glb`);
const lods = [];
for (const [i, lod] of (spec.lods ?? []).entries()) {
  const d = await deliver(lod.glb, `lod-${tag}${spec.lods.length > 1 ? `-${i + 1}` : ''}.glb`);
  lods.push({ url: d.url, sha256: d.sha256, bytes: d.bytes, triangles: d.triangles, distanceMetres: lod.distanceMetres, purpose: lod.purpose ?? 'medium-distance-lod' });
}
// Measured dimensions of the delivered geometry.
const gltf = await geometryScene(path.join(dir, `model-${tag}.glb`));
gltf.scene.updateMatrixWorld(true);
const box = new THREE.Box3().setFromObject(gltf.scene, true);
let radius = 0;
const point = new THREE.Vector3();
gltf.scene.traverse((node) => {
  if (!node.isMesh) return;
  for (let i = 0; i < node.geometry.attributes.position.count; i++) {
    node.getVertexPosition(i, point);
    point.applyMatrix4(node.matrixWorld);
    radius = Math.max(radius, Math.hypot(point.x, point.z));
  }
});
const height = box.max.y - box.min.y;

const manifestPath = path.join(root, 'public/models/world-assets.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const entry = manifest.assets.find((a) => a.modelKey === key);
const perModelPath = path.join(dir, 'asset.json');
const perModel = (await exists(perModelPath)) ? JSON.parse(await readFile(perModelPath, 'utf8')) : null;
const base = entry ?? perModel;
if (!base) throw new Error(`No manifest entry for ${key}`);
const previous = { url: base.url, sha256: base.sha256, triangles: base.triangles, bytes: base.bytes, candidate: base.candidate, revision: base.revision ?? null };
const provenance = {
  provider: 'Claude Code (Opus 5.5)',
  claudeUsed: true,
  referenceGenerator: 'Codex CLI built-in image_gen (gpt-5.6-sol, medium), earlier approved reference attached for identity',
  referenceImage: spec.reference,
  referenceSha256: await sha(spec.reference),
  reconstruction: 'Local TRELLIS-2 v0.8.1, res 1024, tex 1024, seed recorded in dense JSON',
  denseFile: spec.dense,
  denseSha256: await sha(spec.dense),
  processReport: spec.processReport,
  rigReport: spec.rigReport ?? null,
  pipeline: 'scripts/remake/ (trellis_queue.py, remake_process.py, rig_*.py); docs/asset-remake/PLAN.md',
  previousDelivery: previous,
  previousProvenance: base.provenance ?? null,
  ...(spec.provenance ?? {}),
};
const updated = {
  ...base,
  candidate: spec.candidate ?? 2,
  revision: spec.revision ?? `c${spec.candidate ?? 2}-${path.basename(path.dirname(spec.glb))}`,
  status: 'remake-candidate-2-integrated',
  url: main.url,
  sha256: main.sha256,
  bytes: main.bytes,
  triangles: main.triangles,
  heightMetres: spec.heightMetres ?? Number(height.toFixed(4)),
  ...(spec.placement ? { placement: { ...base.placement, ...spec.placement } } : {}),
  ...(spec.clips ? { clips: spec.clips } : main.clips.length ? { clips: main.clips } : {}),
  ...(spec.locomotion ? { locomotion: spec.locomotion } : {}),
  ...(spec.extra ?? {}),
  lods,
  notes: [...(spec.notes ?? [])],
  provenance,
};
if (entry) manifest.assets[manifest.assets.indexOf(entry)] = updated;
if (entry) await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
if (perModel) await writeFile(perModelPath, JSON.stringify({ ...perModel, ...updated }, null, 2) + '\n');

// Collision bounds (shared/model-bounds.mts) for keys that have them; edit only this key's entry.
const boundsPath = path.join(root, 'shared/model-bounds.mts');
let boundsText = await readFile(boundsPath, 'utf8');
const marker = `  '${key}': {`;
if (boundsText.includes(marker)) {
  const start = boundsText.indexOf(marker);
  const end = boundsText.indexOf('\n  },', start) + 5;
  const old = boundsText.slice(start, end);
  const trunk = old.includes('trunk:') ? old.slice(old.indexOf('    trunk:'), old.lastIndexOf('\n  },')) : null;
  const block = `  '${key}': {\n    min: ${JSON.stringify(box.min.toArray()).replace(/,/g, ', ')},\n    max: ${JSON.stringify(box.max.toArray()).replace(/,/g, ', ')},\n    radius: ${radius},\n    sha256: '${main.sha256}',${trunk ? `\n${trunk}` : ''}\n  },`;
  boundsText = boundsText.slice(0, start) + block + boundsText.slice(end);
  await writeFile(boundsPath, boundsText);
}
console.log(JSON.stringify({ key, main, lods, height, radius, bounds: { min: box.min.toArray(), max: box.max.toArray() }, previous }, null, 1));
