import { readFile, writeFile, copyFile, mkdir, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const json = async (p) => JSON.parse(await readFile(p, 'utf8'));
const save = (p, v) => writeFile(p, JSON.stringify(v, null, 2) + '\n');
const hash = (b) => createHash('sha256').update(b).digest('hex');
const destination = 'assets/violet-behemoth',
  model = 'output/model-generation/models/violet-behemoth';
const qaFile = process.argv[2];
assert.ok(qaFile, 'Pass completed browser summary.json');
const qa = await json(qaFile),
  asset = await json('public/models/violet-behemoth/asset.json');
const delivery = await json(`${destination}/delivery.json`);
assert.equal(delivery.sha256, asset.sha256);
assert.equal(asset.revision, '03');
assert.deepEqual(qa.errors, []);
assert.ok(qa.checks.length >= 9);
assert.ok(qa.samples.length > 50);
for (const s of qa.samples) if (s.enemy?.hash) assert.equal(s.enemy.hash, asset.sha256);
for (const clip of ['Idle_Loop', 'Alert', 'Charge', 'Attack', 'TailSpin', 'Death'])
  assert.ok(
    qa.samples.some((s) => s.enemy?.clip === clip && s.enemy.visible),
    `Missing ${clip}`,
  );
const folder = `${model}/work/rig/revision-${asset.revision}`;
assert.equal(hash(await readFile(`${folder}/candidate.glb`)), asset.sha256);
const numeric = await json(`${folder}/qa/numeric.json`);
assert.equal(numeric.numericPass, true);
assert.deepEqual(
  await readFile(`${model}/source/original/user-reference.png`),
  await readFile('C:/Users/yurin/Downloads/ChatGPT Image Sep 9, 2026, 09_16_01 PM.png'),
);
asset.status = 'integrated-and-game-qa-passed';
asset.notes = [
  'User-supplied reference, vestigial hind legs, forearm/tail propulsion. Local TRELLIS-2 reconstruction; no visible replacement geometry.',
  'Total length 6 m: retained body, extended tail. Revision 03 improves the final death pose; surface, material and eight other clips match revision 02.',
];
await save('public/models/violet-behemoth/asset.json', asset);
const catalog = await json('public/models/world-assets.json');
catalog.assets[catalog.assets.findIndex((a) => a.modelKey === asset.modelKey)] = asset;
await save('public/models/world-assets.json', catalog);
const models = await json('assets/world-models.json');
const entry = {
  key: asset.modelKey,
  name: asset.name,
  kind: 'enemy',
  height: asset.heightMetres,
  length: 6,
  status: asset.status,
  geometryResolution: 1024,
  sha256: asset.sha256,
  delivery: asset.url,
  gameQA: `${destination}/game-qa.json`,
  subject:
    'User reference: massive purple forearms, tiny vestigial hind legs, many eyes and a long tail; territorial grassland monster.',
};
const index = models.assets.findIndex((a) => a.key === entry.key);
if (index < 0) models.assets.push(entry);
else models.assets[index] = entry;
await save('assets/world-models.json', models);
await save(`${destination}/game-qa.json`, qa);
await save(`${destination}/numeric.json`, numeric);
await copyFile(
  `${model}/work/rig/revision-02/qa/render-manifest.json`,
  `${destination}/render-r02.json`,
);
await copyFile(`${folder}/qa/render-manifest.json`, `${destination}/render-r03-death.json`);
await copyFile(`${model}/request-spec.json`, `${destination}/request-spec.json`);
async function archive(from, to) {
  await mkdir(to, { recursive: true });
  for (const e of await readdir(from, { withFileTypes: true })) {
    if (e.name === '__pycache__') continue;
    if (e.isDirectory()) await archive(`${from}/${e.name}`, `${to}/${e.name}`);
    else await copyFile(`${from}/${e.name}`, `${to}/${e.name}`);
  }
}
await archive(`${model}/source/original`, `${destination}/source`);
await archive(`${model}/workflow`, `${destination}/workflow`);
const lineage = [];
async function inventory(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name === '__pycache__') continue;
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) await inventory(p);
    else {
      const b = await readFile(p);
      lineage.push({ path: p, bytes: b.length, sha256: hash(b) });
    }
  }
}
await inventory(model);
await save(`${destination}/production.json`, { modelRoot: model, files: lineage });
await copyFile(
  `${model}/work/rig/revision-02/qa/Idle_Loop-right-00.png`,
  `${destination}/six-metre-side.png`,
);
await save(`${destination}/adoption.json`, {
  ...asset,
  adoptedAt: new Date().toISOString(),
  browserSource: qaFile,
  visualReview:
    'Six directions across nine clips, selected full-size poses and actual game playback. Death end pose corrected to a grounded side fall.',
  preservedClips: delivery.retainedClips,
  productionFileCount: lineage.length,
});
console.log(
  JSON.stringify({
    adopted: asset.modelKey,
    revision: asset.revision,
    sha256: asset.sha256,
    productionFiles: lineage.length,
  }),
);
