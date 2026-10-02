// Register the complete new set only after exact-file model QA and visual review.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, copyFile, constants } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const read = async (p) => JSON.parse(await readFile(p, 'utf8'));
const save = (p, v) => writeFile(p, JSON.stringify(v, null, 2) + '\n');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const revisions = await read('assets/shape-bots/revisions.json');
const specs = (await read('assets/shape-bots/source/imagegen-prompts.json')).specs;
const prior = await read('assets/shape-bots/request.json');
for (const item of prior.existingAssets)
  assert.equal(hash(await readFile(`public${item.url}`)), item.sha256);
const catalog = await read('assets/world-models.json');
const world = await read('public/models/world-assets.json');
const records = [];
for (const [kind, revision] of Object.entries(revisions)) {
  const key = `orb-bot-${kind}`;
  const source = `output/model-generation/models/${key}/work/rig/revision-${revision}/candidate.glb`;
  const base = source.slice(0, -'candidate.glb'.length);
  const numeric = await read(`${base}qa/numeric.json`);
  const rig = await read(`${base}rig.json`);
  const reviewPath = `assets/shape-bots/reviews/${kind}-r${revision}.json`;
  const review = await read(reviewPath);
  const bytes = await readFile(source),
    sha256 = hash(bytes);
  assert.equal(numeric.numericPass, true);
  assert.equal(numeric.sha256, sha256);
  assert.equal(review.sha256, sha256);
  assert.equal(review.decision, 'visual-approved-for-game-qa');
  const angles = await read(
    `output/model-generation/models/${key}/qa/final-${revision}/motion-angles/qa.json`,
  );
  assert.equal(angles.passed, true);
  assert.equal(angles.sha256, sha256);
  const inspection = JSON.parse(
    execFileSync(process.execPath, ['scripts/inspect-glb.mjs', source], { encoding: 'utf8' }),
  );
  assert.equal(inspection.validation, 'passed');
  assert.equal(inspection.animations.length, 7);
  assert.ok(!catalog.assets.some((a) => a.key === key), 'Do not overwrite an existing delivery');
  const destination = `public/models/${key}`;
  await mkdir(destination, { recursive: true });
  const sourceImage = `assets/shape-bots/source/${kind}-reference-v1.png`;
  for (const [from, to] of [
    [source, `model-r${revision}.glb`],
    [`${base}lod.glb`, `lod-r${revision}.glb`],
    [sourceImage, 'portrait.png'],
  ]) {
    try {
      await copyFile(from, `${destination}/${to}`, constants.COPYFILE_EXCL);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    assert.equal(hash(await readFile(from)), hash(await readFile(`${destination}/${to}`)));
  }
  const lod = await readFile(`${base}lod.glb`);
  const name = specs.find((s) => s.kind === kind).name;
  const manifest = {
    modelKey: key,
    name,
    kind: 'companion',
    candidate: 1,
    revision,
    status: 'candidate-game-QA',
    url: `/models/${key}/model-r${revision}.glb`,
    sha256,
    bytes: bytes.length,
    triangles: inspection.triangles,
    bones: 2,
    upAxis: 'Y',
    forwardAxis: '+Z',
    heightMetres: rig.heightMetres,
    widthMetres: rig.widthMetres,
    lengthMetres: rig.lengthMetres,
    placement: { pivot: 'ground-centred', scale: 1 },
    portrait: { url: `/models/${key}/portrait.png`, sha256: hash(await readFile(sourceImage)) },
    clips: inspection.animations.map((c) => ({
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
        url: `/models/${key}/lod-r${revision}.glb`,
        sha256: hash(lod),
        bytes: lod.length,
        triangles: numeric.lod.triangles,
        distanceMetres: 9,
        purpose: 'animated-medium-lod-geometry',
      },
    ],
    provenance: {
      provider: 'Codex',
      claudeUsed: false,
      referenceGenerator: 'Built-in imagegen',
      referenceImage: sourceImage,
      referenceSha256: hash(await readFile(sourceImage)),
      userReference: prior.source,
      userReferenceSha256: prior.sourceSha256,
      reconstruction:
        'Local TRELLIS-2 v0.8.1 official Vulkan / 512 / seed42; measured source-preserving reduction and squash/hop rig.',
      denseSha256: rig.sourceSha256,
      sourceUvAndAlbedoPreserved: rig.sourceUvAndAlbedoPreserved,
      sourceUvPreserved: rig.sourceUvPreserved,
      materialRepair: rig.materialRepair,
      candidateFile: source,
      visualReview: reviewPath,
    },
    notes: [
      'Each of the four subjects has its own independent image and dense reconstruction. No visible primitive-built geometry.',
      'Five loop clips and two one-shots; in-place, server-timed throws and return; original skeleton and material shared with LOD.',
    ],
  };
  await save(`${destination}/asset.json`, manifest);
  catalog.assets.push({
    key,
    name,
    kind: 'companion',
    height: rig.heightMetres,
    geometryResolution: 512,
    referenceVersion: 1,
    status: manifest.status,
    sha256,
    delivery: manifest.url,
    subject: specs.find((s) => s.kind === kind).subject,
  });
  world.assets.push(manifest);
  records.push({ key, sha256, triangles: manifest.triangles });
}
await save('assets/world-models.json', catalog);
await save('public/models/world-assets.json', world);
console.log(JSON.stringify(records));
