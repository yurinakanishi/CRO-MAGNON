import { readFile, writeFile, mkdir, copyFile, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { geometryScene } from './measure-collision-bounds.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const model = resolve(root, 'output/model-generation/models/crow-shaman');
const candidate = await realpath(resolve(root, process.argv[2] || 'MISSING_CANDIDATE'));
const inside = relative(await realpath(model), candidate);
assert.ok(inside && !inside.startsWith('..') && !isAbsolute(inside), 'Candidate must belong to crow-shaman');
const json = async name => JSON.parse((await readFile(name, 'utf8')).replace(/^\uFEFF/, ''));
const save = (name, value) => writeFile(name, JSON.stringify(value, null, 2) + '\n');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const portable = file => relative(root, file).replaceAll('\\', '/');
const bytes = await readFile(candidate), hash = sha(bytes);
const reviewPath = resolve(model, 'qa/adoption-review.json'), review = await json(reviewPath);
assert.equal(review.decision, 'adopt'); assert.equal(review.sha256, hash);
assert.equal(review.referenceImage, 'source/original/reference-v2.png');
for (const name of ['Walk_Loop', 'Run_Loop']) assert.ok(review.locomotion?.[name]?.metresPerSecond > 0);
const inspection = JSON.parse(execFileSync(process.execPath, [resolve(root, 'scripts/inspect-glb.mjs'), candidate, '--enemy'], { encoding: 'utf8' }));
assert.equal(inspection.validation, 'passed'); assert.equal(inspection.animations.length, 6);
const geometry = await geometryScene(candidate); geometry.scene.updateMatrixWorld(true);
const bounds = new THREE.Box3().setFromObject(geometry.scene, true), size = bounds.getSize(new THREE.Vector3());
assert.ok(size.y > 1.5 && size.y < 2.3, 'Review measured game height');
assert.ok(Math.abs(bounds.min.y) < .035, 'Review foot origin');
const refPath = resolve(model, review.referenceImage), reference = await readFile(refPath);
const destination = resolve(root, 'public/models/crow-shaman'); await mkdir(destination, { recursive: true });
async function copyPreserving(source, target) {
  try { await copyFile(source, target, constants.COPYFILE_EXCL); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  assert.equal(sha(await readFile(target)), sha(await readFile(source)), `Existing file differs: ${target}`);
}
await copyPreserving(candidate, resolve(destination, 'model.glb'));
await mkdir(resolve(model, 'geometry'), { recursive: true });
await copyPreserving(candidate, resolve(model, 'geometry/accepted.glb'));
const manifest = {
  modelKey: 'crow-shaman', name: '白羽の呪術師', kind: 'enemy', candidate: 1,
  status: 'reviewed-prototype', url: '/models/crow-shaman/model.glb', sha256: hash,
  bytes: bytes.length, triangles: inspection.triangles, upAxis: 'Y', forwardAxis: '+Z',
  heightMetres: size.y, widthMetres: size.x,
  placement: { pivot: 'ground-centred', min: bounds.min.toArray(), max: bounds.max.toArray() },
  bones: inspection.skins[0].joints,
  clips: inspection.animations.map(a => ({ name: a.name, seconds: a.duration, loop: a.name.endsWith('_Loop') })),
  locomotion: review.locomotion, lods: [], notes: review.notes || [],
  provenance: {
    provider: 'Codex', claudeUsed: false, referenceGenerator: 'Built-in imagegen',
    referenceImage: portable(refPath), referenceSha256: sha(reference),
    selectedConceptImage: 'output/imagegen/crow-enemy-candidates-20260907/03-crow-shaman.png',
    selectedConceptSha256: '9db04a0e910a84014c95477b9055fababb4378be7226160bb8c82bcb0c5b6d72',
    reconstruction: 'Local TRELLIS-2; selected-dense.json and settings retained in model workspace',
    candidateFile: portable(candidate), visualReview: portable(reviewPath),
  },
};
const catalogPath = resolve(root, 'assets/world-models.json'), catalog = await json(catalogPath);
const old = catalog.assets.find(a => a.key === 'crow-shaman');
if (old) assert.equal(old.sha256, hash, 'Preserve a previously adopted candidate');
else catalog.assets.push({ key: 'crow-shaman', name: manifest.name, kind: 'enemy', height: size.y,
  geometryResolution: 1024, referenceVersion: 2, status: 'adopted-awaiting-game-QA',
  sha256: hash, delivery: manifest.url, subject: 'User-selected white-crested crow shaman with primitive hide clothing and a stone-topped wooden staff.' });
await save(resolve(destination, 'asset.json'), manifest);
await save(catalogPath, catalog);
const world = await json(resolve(root, 'public/models/world-assets.json'));
world.assets = world.assets.filter(a => a.modelKey !== 'crow-shaman'); world.assets.push(manifest);
await save(resolve(root, 'public/models/world-assets.json'), world);
await save(resolve(model, 'qa/delivery-inspection.json'), inspection);
await save(resolve(model, 'qa/delivery-manifest.json'), manifest);
const requestPath = resolve(root, 'assets/crow-shaman-request.json'), request = await json(requestPath);
Object.assign(request.status, { generation: 'completed', adoption: 'exact-glb-reviewed-and-adopted', gameIntegration: 'awaiting-browser-QA' });
request.delivery = { url: manifest.url, sha256: hash, triangles: manifest.triangles, bytes: manifest.bytes };
await save(requestPath, request);
console.log(JSON.stringify({ modelKey: manifest.modelKey, sha256: hash, bytes: manifest.bytes, triangles: manifest.triangles, bounds: manifest.placement, status: 'adopted-awaiting-game-QA' }, null, 2));
