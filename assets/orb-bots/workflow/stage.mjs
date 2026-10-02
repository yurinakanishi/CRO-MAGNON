// Copy byte-identical reviewed candidates, then register all five as a single complete set.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, copyFile, constants } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { BOT_KINDS, BOT_DESIGNS } from '../../../dist/shared/orb-bots.mjs';
const hash = (b) => createHash('sha256').update(b).digest('hex');
const json = async (p) => JSON.parse(await readFile(p, 'utf8'));
const save = (p, v) => writeFile(p, JSON.stringify(v, null, 2) + '\n');
const revisions = await json('assets/orb-bots/revisions.json');
const records = [];
for (const colour of BOT_KINDS) {
  const revision = revisions[colour];
  assert.match(revision, /^\d{2}$/);
  const key = `orb-bot-${colour}`,
    base = `output/model-generation/models/${key}`;
  const source = `${base}/work/rig/revision-${revision}/candidate.glb`,
    bytes = await readFile(source),
    sha = hash(bytes);
  const numeric = await json(`${base}/work/rig/revision-${revision}/qa/numeric.json`);
  const review = await json(`assets/orb-bots/reviews/${colour}-r${revision}.json`);
  assert.equal(numeric.numericPass, true);
  assert.equal(numeric.sha256, sha);
  assert.equal(review.decision, 'visual-approved-for-game-qa');
  assert.equal(review.sha256, sha);
  const info = JSON.parse(
    execFileSync(process.execPath, ['scripts/inspect-glb.mjs', source], { encoding: 'utf8' }),
  );
  assert.equal(info.validation, 'passed');
  assert.equal(info.animations.length, 7);
  assert.equal(info.skins[0].joints, 2);
  const rig = await json(`${base}/work/rig/revision-${revision}/rig.json`),
    destination = `public/models/${key}`;
  const previous = await json(`${destination}/asset.json`).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
    return null;
  });
  if (previous) {
    assert.equal(previous.revision, rig.paddingRevisionFrom);
    assert.equal(previous.status, 'candidate-game-QA');
    assert.equal(
      previous.sha256,
      hash(await readFile(`${base}/work/rig/revision-${previous.revision}/candidate.glb`)),
    );
    await mkdir('assets/orb-bots/history', { recursive: true });
    await writeFile(
      `assets/orb-bots/history/${colour}-asset-r${previous.revision}.json`,
      JSON.stringify(previous, null, 2) + '\n',
      { flag: 'wx' },
    );
  }
  const lodSource = `${base}/work/rig/revision-${revision}/lod.glb`,
    lodBytes = await readFile(lodSource),
    lodSha = hash(lodBytes);
  assert.equal(numeric.lod.sha256, lodSha);
  assert.equal(numeric.sharedInverseBindMatricesExact, true);
  assert.equal(numeric.sharedRestTransformsExact, true);
  await mkdir(destination, { recursive: true });
  const final = `${destination}/model-r${revision}.glb`;
  try {
    await copyFile(source, final, constants.COPYFILE_EXCL);
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
  }
  assert.equal(hash(await readFile(final)), sha);
  const lodRevision = previous?.revision ?? revision;
  const lodFinal = `${destination}/lod-r${lodRevision}.glb`;
  try {
    await copyFile(lodSource, lodFinal, constants.COPYFILE_EXCL);
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
  }
  assert.equal(hash(await readFile(lodFinal)), lodSha);
  const referenceImage = `assets/orb-bots/source/${colour}-reference-v1.png`;
  const manifest = {
    modelKey: key,
    name: BOT_DESIGNS[colour].name,
    kind: 'companion',
    candidate: 1,
    revision,
    status: 'candidate-game-QA',
    url: `/models/${key}/model-r${revision}.glb`,
    sha256: sha,
    bytes: bytes.length,
    triangles: info.triangles,
    bones: 2,
    upAxis: 'Y',
    forwardAxis: '+Z',
    heightMetres: rig.heightMetres,
    widthMetres: rig.widthMetres,
    lengthMetres: rig.lengthMetres,
    placement: { pivot: 'ground-centred', scale: 1 },
    clips: info.animations.map((c) => ({
      name: c.name,
      seconds: c.duration,
      loop: c.name.endsWith('_Loop'),
      rootMotion: 'in-place',
      fps: 60,
    })),
    locomotion: {
      Walk_Loop: { metresPerSecond: 3, cycleSeconds: 0.6 },
      Run_Loop: { metresPerSecond: 3, cycleSeconds: 0.4 },
    },
    lods: [
      {
        url: `/models/${key}/lod-r${lodRevision}.glb`,
        sha256: lodSha,
        bytes: lodBytes.length,
        triangles: numeric.lod.triangles,
        distanceMetres: 9,
        purpose: 'animated-medium-lod-geometry',
      },
    ],
    provenance: {
      provider: 'Codex',
      claudeUsed: false,
      referenceGenerator: 'Built-in imagegen',
      referenceImage,
      referenceSha256: hash(await readFile(referenceImage)),
      userReference: 'assets/orb-bots/source/user-reference.png',
      userReferenceSha256: hash(await readFile('assets/orb-bots/source/user-reference.png')),
      reconstruction:
        'Local TRELLIS-2 v0.8.1 official Vulkan / 512 / seed42; adaptive source-preserving surface reduction; immutable reference-PNG face ink rebaked into repaired UVs.',
      denseSha256: rig.sourceSha256,
      materialRepair: rig.materialRepair,
      surfaceRepair: rig.surfaceRepair,
      candidateFile: source,
      visualReview: `assets/orb-bots/reviews/${colour}-r${revision}.json`,
    },
    notes: [
      'Each colour was reconstructed separately from its own reference. No primitive-built visible bot geometry.',
      'Squash and hop rig; five loop clips and two one-shots. Ground placement and held/flight paths use the shared server clock.',
    ],
  };
  await save(`${destination}/asset.json`, manifest);
  records.push(manifest);
}
const catalog = await json('assets/world-models.json'),
  world = await json('public/models/world-assets.json');
for (const m of records) {
  const catalogRecord = {
    key: m.modelKey,
    name: m.name,
    kind: 'companion',
    height: m.heightMetres,
    geometryResolution: 512,
    referenceVersion: 1,
    status: m.status,
    sha256: m.sha256,
    delivery: m.url,
    subject: `${m.name}: ${BOT_DESIGNS[m.modelKey.slice(8)].face}; independently reconstructed round companion.`,
  };
  const index = catalog.assets.findIndex((s) => s.key === m.modelKey);
  if (index < 0) catalog.assets.push(catalogRecord);
  else catalog.assets[index] = catalogRecord;
  const worldIndex = world.assets.findIndex((s) => s.modelKey === m.modelKey);
  if (worldIndex < 0) world.assets.push(m);
  else world.assets[worldIndex] = m;
}
await save('assets/world-models.json', catalog);
await save('public/models/world-assets.json', world);
console.log(
  JSON.stringify(
    records.map((m) => ({ key: m.modelKey, sha256: m.sha256, triangles: m.triangles })),
  ),
);
