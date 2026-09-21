import assert from 'node:assert/strict';
import { readFile, writeFile, copyFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const revision = process.argv[2] || '10',
  json = async (p) => JSON.parse(await readFile(p, 'utf8'));
const write = (p, x) => writeFile(p, JSON.stringify(x, null, 2) + '\n'),
  hash = (b) => createHash('sha256').update(b).digest('hex');
const validation = await json(`assets/female-face-repair/validation-r${revision}.json`);
assert.equal(validation.status, 'passed');
assert.equal(validation.results.length, 2);
const visual = await json(`assets/female-face-repair/visual-review-r${revision}.json`);
assert.equal(visual.decision, 'adopt');
const catalog = await json('assets/world-models.json'),
  world = await json('public/models/world-assets.json'),
  records = [];
for (const key of ['cro-magnon-woman', 'neanderthal-woman']) {
  const base = `assets/female-face-repair/${key}`,
    out = `${base}/work/revision-${revision}`,
    build = await json(`${out}/build.json`),
    asset = await json(`public/models/${key}/asset.json`);
  assert.ok([build.sourceSha256, build.sha256].includes(asset.sha256), 'concurrent asset edit');
  assert.equal(validation.results.find((r) => r.key === key).sha256, build.sha256);
  assert.equal(visual.models.find((r) => r.key === key).sha256, build.sha256);
  const bytes = await readFile(`${out}/model.glb`);
  assert.equal(hash(bytes), build.sha256);
  const low = await readFile(`${out}/lod.glb`),
    inspection = JSON.parse(
      execFileSync(process.execPath, ['scripts/inspect-glb.mjs', `${out}/lod.glb`], {
        encoding: 'utf8',
      }),
    );
  assert.equal(inspection.validation, 'passed');
  assert.equal(inspection.animations.length, 0);
  const original = await json('assets/female-face-repair/baseline.json'),
    previous = original.find((r) => r.key === key).asset;
  asset.url = `/models/${key}/model-face-r${revision}.glb`;
  asset.sha256 = build.sha256;
  asset.bytes = bytes.length;
  asset.triangles = build.triangles;
  asset.lods = [
    {
      url: `/models/${key}/lod-face-r${revision}.glb`,
      sha256: hash(low),
      bytes: low.length,
      triangles: inspection.triangles,
      distanceMetres: 28,
      purpose: 'animated-medium-lod-geometry',
    },
  ];
  asset.faceRepair = {
    revision,
    source: build.source,
    sourceSha256: build.sourceSha256,
    headReference: `${base}/source/reference-v1.png`,
    headReconstruction: `${base}/work/trellis/reconstruction.json`,
    build: `${out}/build.json`,
    validation: `assets/female-face-repair/validation-r${revision}.json`,
    visualReview: `assets/female-face-repair/visual-review-r${revision}.json`,
    status: 'adopted-pending-game-qa',
  };
  asset.provenance.previousFaceReference = {
    path: previous.provenance.referenceImage,
    sha256: previous.provenance.referenceSha256,
  };
  asset.provenance.previousFaceVisualReview = previous.provenance.visualReview;
  asset.provenance.referenceImage = asset.faceRepair.headReference;
  asset.provenance.referenceSha256 = hash(await readFile(asset.faceRepair.headReference));
  asset.provenance.visualReview = `${base}/adoption-review-r${revision}.json`;
  asset.provenance.previousFaceCandidate = previous.provenance.candidateFile;
  asset.provenance.candidateFile = 'public' + asset.url;
  asset.notes = asset.notes.filter(
    (n) =>
      !n.startsWith('Source-derived 9,856-triangle') && !n.includes('animated LOD is used beyond'),
  );
  asset.notes.push(
    `Source-derived ${inspection.triangles.toLocaleString('en-US')}-triangle geometry LOD beyond 28 m; primitive order, joint indices, retained vertex attributes and original clip bytes verified.`,
  );
  asset.notes.push(
    'Head repaired from a close-up imagegen reference and local TRELLIS-2. Body below neck, original skeleton and all 10 animation clips retained; source neck seam verified across every clip.',
  );
  await mkdir(`public/models/${key}`, { recursive: true });
  for (const [src, dst] of [
    [`${out}/model.glb`, 'public' + asset.url],
    [`${out}/lod.glb`, 'public' + asset.lods[0].url],
  ]) {
    try {
      await copyFile(src, dst, 1);
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      assert.equal(hash(await readFile(src)), hash(await readFile(dst)));
    }
  }
  assert.equal(
    hash(await readFile(`public/models/${key}/portrait.png`)),
    hash(await readFile(`${base}/source/portrait-before.png`)),
    'portrait unchanged since review',
  );
  await copyFile(`${out}/portrait.png`, `public/models/${key}/portrait.png`);
  await write(asset.provenance.visualReview, {
    decision: 'adopt',
    key,
    revision,
    sha256: asset.sha256,
    source: build.source,
    sourceSha256: build.sourceSha256,
    validation: asset.faceRepair.validation,
    visualReview: asset.faceRepair.visualReview,
    gameQA: 'pending',
    preserved:
      'Original binary, body below neck, original materials and textures, nodes, skin inverse binds, all animation clips.',
  });
  await write(`public/models/${key}/asset.json`, asset);
  const i = world.assets.findIndex((a) => a.modelKey === key);
  if (i >= 0) world.assets[i] = asset;
  const entry = catalog.assets.find((a) => a.key === key);
  Object.assign(entry, {
    sha256: asset.sha256,
    delivery: asset.url,
    gameQA: 'assets/female-face-repair/README.md',
  });
  records.push({
    key,
    url: asset.url,
    sha256: asset.sha256,
    bytes: asset.bytes,
    triangles: asset.triangles,
    lod: asset.lods[0],
  });
}
await write('assets/world-models.json', catalog);
await write('public/models/world-assets.json', world);
await write('assets/female-face-repair/adoption.json', {
  revision,
  records,
  gameQA: 'pending',
  publicDeployment: false,
});
console.log(JSON.stringify(records));
