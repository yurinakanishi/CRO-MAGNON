import assert from 'node:assert/strict';
import { readFile, writeFile, copyFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const dir = 'output/mammoth-tail/revision-11',
  records = 'assets/mammoth-tail';
const json = async (file) => JSON.parse(await readFile(file, 'utf8'));
const put = async (file, data) => writeFile(file, JSON.stringify(data, null, 2) + '\n');
const bytes = await readFile(`${dir}/model.glb`),
  build = await json(`${dir}/build.json`),
  validation = await json(`${dir}/validation.json`);
const hash = createHash('sha256').update(bytes).digest('hex');
assert.equal(hash, build.sha256);
assert.equal(validation.status, 'passed');
const visual = await json('output/playwright/mammoth-tail-structure-r11/review.json');
assert.equal(visual.status, 'passed');
const key = 'woolly-mammoth',
  delivery = `public/models/${key}/model-tail-r11.glb`,
  url = `/models/${key}/model-tail-r11.glb`;
await mkdir(records, { recursive: true });
const asset = await json(`public/models/${key}/asset.json`);
if (asset.url !== url) await put(`${records}/previous-r05-asset.json`, asset);
await copyFile(`${dir}/model.glb`, delivery);
asset.url = url;
asset.sha256 = hash;
asset.bytes = bytes.length;
asset.triangles = build.triangles;
asset.notes = asset.notes.filter(
  (n) => !n.startsWith('Tail revision 05') && !n.startsWith('Tail structural revision'),
);
asset.notes.push(
  'Tail structural revision 11 (2026-09-13): Blender 5.2 cuts the forked posterior surface, closes and relaxes the rump, and extrudes one rounded, tapered tail with a terminal fur tuft from the existing central attachment loop. Continuous flank fur is baked from the original TRELLIS texture. Tail/rump skin weights are repaired. Original 24 bones and all five clips remain byte-identical; r04 and rejected r05 remain archived.',
);
const review = `${records}/review-r11.json`;
asset.provenance.previousVisualReview = asset.provenance.visualReview;
asset.provenance.visualReview = review;
if (asset.provenance.tailRepair) {
  asset.provenance.previousTailRepair = asset.provenance.tailRepair;
  delete asset.provenance.tailRepair;
}
asset.provenance.structuralRepair = {
  revision: 'revision-11',
  provider: 'Codex',
  claudeUsed: false,
  tripoUsed: false,
  source: 'public/models/woolly-mammoth/model-motion-r04.glb',
  sourceSha256: build.sourceSha256,
  builder: 'scripts/blender-mammoth-tail.py',
  packager: 'scripts/build-mammoth-tail-glb.mjs',
  blenderVersion: '5.2.0',
  blend: `${dir}/mammoth-tail.blend`,
};
asset.motionReview.delivery = 'model-tail-r11.glb';
await put(`public/models/${key}/asset.json`, asset);
const world = await json('public/models/world-assets.json');
world.assets[world.assets.findIndex((a) => a.modelKey === key)] = asset;
await put('public/models/world-assets.json', world);
const catalog = await json('assets/world-models.json'),
  spec = catalog.assets.find((a) => a.key === key);
spec.delivery = url;
spec.sha256 = hash;
spec.triangles = build.triangles;
await put('assets/world-models.json', catalog);
await put(review, {
  decision: 'adopt',
  at: new Date().toISOString(),
  key,
  revision: 'revision-11',
  sha256: hash,
  bytes: bytes.length,
  triangles: build.triangles,
  sourceSha256: build.sourceSha256,
  reviewedBy: 'Codex',
  method: 'Blender mesh edit, exact GLB reload in Blender and Chrome, 240 Hz CPU skin validation',
  visualEvidence: 'output/playwright/mammoth-tail-structure-r11/',
  blenderEvidence: dir,
  repaired:
    'The two fork branches are removed structurally. One round tail is connected to the existing attachment with 15 longitudinal rings and blended Hips/Tail1/Tail2 weights; closure faces are subdivided and relaxed. No zero-area vertex collapse is used.',
  preserved:
    'Original binary prefix, skeleton and five clips. Outside the rump, source surface positions and deformation agree to sub-micrometre numerical error. Original texture remains embedded; the repair texture is baked from that texture in Blender.',
  validation,
  limitations: [
    'Original irregular fur geometry remains beneath the rump.',
    'Full mesh self-intersection and individual-foot slope IK are not certified by this local tail repair.',
  ],
});
await put(`${records}/adoption.json`, {
  url,
  sha256: hash,
  bytes: bytes.length,
  triangles: build.triangles,
  sourceSha256: build.sourceSha256,
});
console.log({ url, sha256: hash, bytes: bytes.length, triangles: build.triangles });
