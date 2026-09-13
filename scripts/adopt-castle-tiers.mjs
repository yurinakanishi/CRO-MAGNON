// Adopt the stepped temple-fortress (2026-09-13): copy a low-poly candidate
// into public/models under a revisioned name, write its manifest with
// provenance, and register it in both catalogs. The ruin's model-r10.glb and
// the old keep's model.glb stay as history.
// Usage: node scripts/adopt-castle-tiers.mjs <candidate> <walk-revision>
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const [candidateNo, walkRevision] = process.argv.slice(2);
assert.ok(
  /^\d{2}$/.test(candidateNo ?? '') && /^\d{2}$/.test(walkRevision ?? ''),
  'Usage: adopt-castle-tiers.mjs <candidate> <walk-revision>',
);
const key = 'valley-castle',
  root = `output/model-generation/models/${key}`,
  candidate = `${root}/work/low-poly/candidate-${candidateNo}/candidate.glb`;
const json = async (p) => JSON.parse(await readFile(p, 'utf8')),
  save = (p, v) => writeFile(p, JSON.stringify(v, null, 2) + '\n'),
  sha = (b) => createHash('sha256').update(b).digest('hex');
const bytes = await readFile(candidate),
  hash = sha(bytes),
  report = await json(`${root}/work/low-poly/candidate-${candidateNo}/process-report.json`),
  walk = await json(`${root}/qa/walk-rev${walkRevision}.json`),
  spec = await json(`${root}/request-spec.json`),
  reference = `${root}/source/original/reference-v${spec.referenceVersion}.png`,
  referenceRecord = await json(`${root}/source/original/reference-v${spec.referenceVersion}.json`);
assert.equal(
  walk.sourceSha256,
  hash,
  'the installed walk atlas must be measured from this exact GLB',
);
const b = report.alignment.bounds_blender_z_up;
const destination = `public/models/${key}`,
  url = `/models/${key}/model-r${candidateNo}.glb`;
await mkdir(destination, { recursive: true });
await writeFile(`public${url}`, bytes);
assert.equal(sha(await readFile(`public${url}`)), hash);
const review = {
  decision: 'adopt',
  sha256: hash,
  candidate: candidateNo,
  reviewedAt: new Date().toISOString(),
  views: `${root}/qa/candidate-${candidateNo}-views.png`,
  walkAtlas: `${root}/qa/walk-rev${walkRevision}-walk.png`,
  notes:
    'Seven software views of every triangle reviewed: a stepped temple-fortress of five levels: a walled forecourt behind a collapsed arch gate, three progressively smaller roofless terraces and a summit altar platform with a ruined throne, each level joined to the next by a grand central stair and two side stairs. The walk atlas (highest connected surface per column, walls solid where an unreached top stands over the internal floor, the gate passage opened by the arch underside) shows the forecourt, the central stairs and all four upper floors as one connected surface up to the summit.',
};
await save(`${root}/qa/adoption-review-tiers.json`, review);
const manifest = {
  modelKey: key,
  name: '白羽教団の大聖城',
  kind: 'static',
  candidate: 1,
  revision: candidateNo,
  status: 'reviewed-prototype',
  environment: true,
  onDemand: true,
  url,
  sha256: hash,
  bytes: bytes.length,
  triangles: report.outputs[0].triangles,
  upAxis: 'Y',
  forwardAxis: '+Z',
  heightMetres: b.max[2] - b.min[2],
  widthMetres: b.max[0] - b.min[0],
  placement: {
    pivot: 'ground-centred',
    min: [b.min[0], b.min[2], -b.max[1]],
    max: [b.max[0], b.max[2], -b.min[1]],
    groundOffset: -13.4,
    note: 'The forecourt floor is 13.4 m above the model base (the outer walls continue down to an apron); placed 13.4 m below the terrain so the forecourt meets the valley floor.',
  },
  clips: [],
  lods: [],
  notes:
    'Rebuilt 2026-09-13 as a stepped temple-fortress: a walled forecourt behind a collapsed arch gate, three progressively smaller roofless terraces and a summit altar with a ruined throne, joined by grand central stairs and side stairs; the crow cult is fought one level at a time with the pontiff on the summit. Full mesh shared; the coarse LODs are not adopted.',
  provenance: {
    provider:
      'Codex CLI image_gen reference (gpt-5.6-sol, medium) and local TRELLIS-2; reduction, walk atlas and integration by Claude Code',
    claudeUsed: true,
    referenceGenerator: 'Codex built-in image_gen',
    referenceImage: reference,
    referenceSha256: sha(await readFile(reference)),
    referencePrompt: referenceRecord.prompt,
    reconstruction: `Local TRELLIS-2 1024 seed 42 (reference v${spec.referenceVersion}); shape-preserving quadric reduction at p95 ${report.error_budget.p95_m} m to ${report.outputs[0].triangles} triangles with the source UV and albedo.`,
    candidateFile: candidate,
    visualReview: `${root}/qa/adoption-review-tiers.json`,
    walkAtlas: `${root}/qa/walk-rev${walkRevision}.json`,
  },
};
await save(`${destination}/asset.json`, manifest);
const catalog = await json('assets/world-models.json');
catalog.assets = catalog.assets.filter((a) => a.key !== key);
catalog.assets.push({
  key,
  name: manifest.name,
  kind: 'static',
  width: 110,
  height: manifest.heightMetres,
  geometryResolution: 1024,
  referenceVersion: spec.referenceVersion,
  status: 'adopted-awaiting-game-QA',
  sha256: hash,
  delivery: url,
  subject: manifest.notes,
});
await save('assets/world-models.json', catalog);
const world = await json('public/models/world-assets.json');
world.assets = world.assets.filter((a) => a.modelKey !== key);
world.assets.push(manifest);
await save('public/models/world-assets.json', world);
await mkdir(`assets/${key}`, { recursive: true });
await save(`assets/${key}/adoption-tiers.json`, { ...manifest, review });
for (const name of [
  'codex-request-v4.txt',
  'prompts-v4.json',
  'prompt-v4.txt',
  `reference-v${spec.referenceVersion}.json`,
])
  await copyFile(`${root}/source/original/${name}`, `assets/${key}/${name}`).catch(() => {});
await copyFile(
  `${root}/qa/walk-rev${walkRevision}-walk.png`,
  `assets/${key}/walk-rev${walkRevision}.png`,
).catch(() => {});
console.log(
  JSON.stringify({ key, url, sha256: hash, bytes: bytes.length, triangles: manifest.triangles }),
);
