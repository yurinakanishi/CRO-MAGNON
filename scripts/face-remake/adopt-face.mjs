// Adopt a face-remake GLB pair (2026-10-07) into public/models/<key>/ without touching the previous files.
// node scripts/face-remake/adopt-face.mjs <key> <stageDir with model.glb, lod.glb> <revision> <review.json>
// The review JSON (assets/face-remake/<key>/adoption-review-<revision>.json) must say decision "adopt" and carry the
// exact model SHA. It also supplies `provenance` overrides (new reference/dense, or none for a weights-only fix).
import { copyFile, readFile, writeFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const [key, stage, revision, reviewPath] = process.argv.slice(2);
const root = path.resolve(import.meta.dirname, '../..');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const review = JSON.parse(await readFile(path.join(root, reviewPath), 'utf8'));
const model = await readFile(path.join(root, stage, 'model.glb'));
const lod = await readFile(path.join(root, stage, 'lod.glb'));
if (review.decision !== 'adopt' || review.sha256 !== sha(model)) throw Error('review does not adopt this exact model');
const names = { model: `model-face-${revision}.glb`, lod: `lod-face-${revision}.glb` };
for (const name of Object.values(names)) {
  try {
    await access(path.join(root, 'public/models', key, name));
    throw Error('refusing to overwrite ' + name);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
}
// Validate everything before any file is written.
const inspect = (file, args = []) =>
  JSON.parse(execFileSync(process.execPath, [path.join(root, 'scripts/inspect-glb.mjs'), file, ...args], { encoding: 'utf8' }));
const mi = inspect(path.join(root, stage, 'model.glb'), ['--humanoid', '--hunting']);
const li = inspect(path.join(root, stage, 'lod.glb'));
if (mi.validation !== 'passed' || li.validation !== 'passed') throw Error('inspect-glb failed');
if (!li.skins.length || li.animations.length) throw Error('LOD must keep its skin and carry no clips');
const assetPath = path.join(root, 'public/models', key, 'asset.json');
const asset = JSON.parse(await readFile(assetPath, 'utf8'));
const previous = { url: asset.url, sha256: asset.sha256, bytes: asset.bytes, triangles: asset.triangles, candidate: asset.candidate, revision: asset.revision, lods: asset.lods };
const prov = asset.provenance;
const history = prov.previousDeliveries ?? [];
history.unshift(prov.previousDelivery);
Object.assign(asset, {
  url: `/models/${key}/${names.model}`,
  sha256: sha(model),
  bytes: model.length,
  triangles: mi.triangles,
  revision: `face-${revision}`,
  lods: [{ ...asset.lods[0], url: `/models/${key}/${names.lod}`, sha256: sha(lod), bytes: lod.length, triangles: li.triangles }],
});
asset.provenance = {
  ...prov,
  ...review.provenance,
  visualReview: reviewPath,
  previousDelivery: previous,
  previousDeliveries: history,
};
asset.faceRemake = review.faceRemake;
// cro-magnon-hunter is verified separately by scripts/verify-world-assets.mjs and has no catalogue entry.
const catalogPath = path.join(root, 'assets/world-models.json');
const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
const entry = catalog.assets.find((a) => a.key === key);
if (entry) Object.assign(entry, { sha256: asset.sha256, delivery: asset.url });
const trackerPath = path.join(root, 'assets/asset-remake/tracker.json');
const tracker = JSON.parse(await readFile(trackerPath, 'utf8'));
const tracked = tracker.assets.find((a) => a.key === key);
if (tracked)
  Object.assign(tracked.current, { url: asset.url, sha256: asset.sha256, bytes: asset.bytes, triangles: asset.triangles, lods: [asset.lods[0].url] });
// Everything is prepared; only now write files.
for (const [kind, name] of Object.entries(names))
  await copyFile(path.join(root, stage, `${kind}.glb`), path.join(root, 'public/models', key, name));
await writeFile(assetPath, JSON.stringify(asset, null, 2) + '\n');
if (entry) await writeFile(catalogPath, JSON.stringify(catalog, null, 2) + '\n');
await writeFile(trackerPath, JSON.stringify(tracker, null, 2) + '\n');
console.log(JSON.stringify({ key, url: asset.url, sha256: asset.sha256, triangles: asset.triangles, lod: asset.lods[0] }));
