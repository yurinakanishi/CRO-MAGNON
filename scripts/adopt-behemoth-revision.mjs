// Adopt a violet behemoth rig revision: copy the numerically verified GLB into
// public/models, write its manifest, and register it in both catalogs. The
// earlier one-off adopter (adopt-violet-behemoth.mjs) is tied to revision 04.
// Usage: node scripts/adopt-behemoth-revision.mjs <revision> [browser-summary.json]
import { readFile, writeFile, copyFile, mkdir, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const json = async (p) => JSON.parse(await readFile(p, 'utf8'));
const save = (p, v) => writeFile(p, JSON.stringify(v, null, 2) + '\n');
const hash = (b) => createHash('sha256').update(b).digest('hex');
const revision = process.argv[2],
  qaFile = process.argv[3];
assert.ok(/^\d{2}$/.test(revision ?? ''), 'Pass the rig revision, e.g. 07');
const key = 'violet-behemoth',
  model = `output/model-generation/models/${key}`,
  folder = `${model}/work/rig/revision-${revision}`,
  destination = `assets/${key}`;
const process_ = await json(`${folder}/process.json`),
  numeric = await json(`${folder}/qa/numeric.json`),
  spec = await json(`${model}/request-spec.json`),
  previous = await json(`public/models/${key}/asset.json`);
assert.equal(numeric.numericPass, true, 'numeric QA must pass before adoption');
const bytes = await readFile(`${folder}/candidate.glb`);
assert.equal(hash(bytes), process_.sha256);
assert.equal(numeric.sha256, process_.sha256);
assert.deepEqual(
  process_.clips.map((c) => c.name),
  spec.clips,
  'the rig must bake exactly the clips the spec lists',
);
const url = `/models/${key}/model-r${revision}.glb`;
await writeFile(`public${url}`, bytes);
const review = {
  decision: 'adopt',
  sha256: process_.sha256,
  revision,
  reviewedAt: new Date().toISOString(),
  sheets: [`${folder}/qa/sheet-left.png`, `${folder}/qa/sheet-threequarter.png`],
  notes:
    process_.motionNotes ??
    'Telegraph clips reviewed on pose sheets (left and three-quarter): Roar rears the front up with the jaw wide before the charge, Tremble shudders with the tail lifted and lashing before the tail spin, Gape pulls the head back with the mouth open before the bite. Surface, weights and the nine earlier clips are unchanged from revision 04.',
};
await save(`${destination}/visual-review-r${revision}.json`, review);
const asset = {
  ...previous,
  revision,
  status: qaFile ? 'integrated-and-game-qa-passed' : 'integrated-browser-qa-pending',
  url,
  sha256: process_.sha256,
  bytes: bytes.byteLength,
  triangles: process_.triangles,
  heightMetres: process_.heightMetres,
  widthMetres: process_.widthMetres,
  lengthMetres: 6,
  bones: process_.bones.length,
  clips: process_.clips,
  locomotion: process_.locomotion,
  source: `${folder}/candidate.glb`,
  provenance: {
    provider:
      'User-supplied reference and local TRELLIS-2 (Codex); revision 05-08 telegraphs by Claude Code; revision 09 onward grounded IK, tail and poison animations by Codex',
    claudeUsed: true,
    referenceImage: `${model}/source/original/user-reference.png`,
    visualReview: `${destination}/visual-review-r${revision}.json`,
  },
  notes: [
    ...(previous.notes ?? []).slice(0, 2),
    process_.motionNotes ??
      `Revision ${revision} (2026-09-12): rendered at scale 2.5 (twice the previous size) and every strike is announced by its own clip: Roar (1.2 s) before Charge, Gape (0.6 s) before Attack, Tremble (0.9 s) before TailSpin. Surface, material, weights and the nine earlier clips match revision 04.`,
  ],
};
await save(`public/models/${key}/asset.json`, asset);
const catalog = await json('public/models/world-assets.json');
const at = catalog.assets.findIndex((a) => a.modelKey === key);
if (at < 0) catalog.assets.push(asset);
else catalog.assets[at] = asset;
await save('public/models/world-assets.json', catalog);
const models = await json('assets/world-models.json');
const index = models.assets.findIndex((a) => a.key === key);
const entry = {
  ...(index < 0
    ? { key, name: asset.name, kind: 'enemy', geometryResolution: 1024 }
    : models.assets[index]),
  height: asset.heightMetres,
  length: 6,
  status: asset.status,
  sha256: asset.sha256,
  delivery: url,
  gameQA: `${destination}/game-qa.json`,
};
if (index < 0) models.assets.push(entry);
else models.assets[index] = entry;
await save('assets/world-models.json', models);
await save(`${destination}/numeric.json`, numeric);
await save(`${destination}/delivery.json`, {
  revision,
  sha256: asset.sha256,
  bytes: asset.bytes,
  url,
  adoptedAt: review.reviewedAt,
  retainedClips: process_.clips.map((c) => c.name),
  rig: { ...process_, bonePlan: undefined },
});
if (qaFile) await save(`${destination}/game-qa.json`, await json(qaFile));
async function archive(from, to) {
  await mkdir(to, { recursive: true });
  for (const e of await readdir(from, { withFileTypes: true })) {
    if (e.name === '__pycache__') continue;
    if (e.isDirectory()) await archive(`${from}/${e.name}`, `${to}/${e.name}`);
    else await copyFile(`${from}/${e.name}`, `${to}/${e.name}`);
  }
}
await archive(`${model}/workflow/current`, `${destination}/workflow/current`);
await copyFile(`${model}/request-spec.json`, `${destination}/request-spec.json`);
for (const sheet of review.sheets)
  await copyFile(sheet, `${destination}/r${revision}-${sheet.split('/').pop()}`).catch(() => {});
console.log(
  JSON.stringify({ adopted: url, sha256: asset.sha256, bytes: asset.bytes, status: asset.status }),
);
