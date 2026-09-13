import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const json = async (p) => JSON.parse(await readFile(p, 'utf8'));
const hash = (b) => createHash('sha256').update(b).digest('hex');
const dir = 'assets/violet-behemoth-quadruped';
const asset = await json('public/models/violet-behemoth/asset.json');
assert.equal(asset.variant, 'violet-behemoth-quadruped');
const numeric = await json(`${dir}/numeric.json`),
  bytes = await readFile(`public${asset.url}`);
assert.equal(hash(bytes), asset.sha256);
assert.equal(numeric.sha256, asset.sha256);
assert.equal(numeric.numericPass, true);
assert.equal(numeric.sampleRate, 240);
assert.equal(numeric.skinJoints, 28);
assert.equal(numeric.weights.maxInfluences, 4);
assert.equal(hash(await readFile(asset.source)), asset.sha256);
const g = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8'));
for (const name of [
  'UpperArm.L',
  'UpperArm.R',
  'LowerArm.L',
  'LowerArm.R',
  'Hand.L',
  'Hand.R',
  'UpperLeg.L',
  'UpperLeg.R',
  'LowerLeg.L',
  'LowerLeg.R',
  'Foot.L',
  'Foot.R',
  'Head',
  'Jaw',
  'Tail1',
  'Tail4',
  'Tail7',
])
  assert.ok(
    g.nodes.some((n) => n.name === name),
    name,
  );
assert.equal(g.animations.length, 14);
assert.deepEqual(g.animations.map((a) => a.name).sort(), asset.clips.map((c) => c.name).sort());
const world = await json('public/models/world-assets.json'),
  models = await json('assets/world-models.json');
assert.deepEqual(
  world.assets.find((a) => a.modelKey === asset.modelKey),
  asset,
);
assert.equal(models.assets.find((a) => a.key === asset.modelKey).delivery, asset.url);
assert.equal(
  hash(await readFile(asset.provenance.referenceImage)),
  asset.provenance.referenceSha256,
);
const old = await json(`${dir}/retained-original/asset.json`);
assert.notEqual(old.url, asset.url);
assert.equal(hash(await readFile(`public${old.url}`)), old.sha256);
for (const entry of world.assets)
  assert.notEqual(entry.url, old.url, 'Old behemoth remains unused');
const baseline = await json(`${dir}/baseline.json`);
for (const file of baseline.files)
  assert.equal(hash(await readFile(file.path)), file.sha256, file.path);
const normalize = (s) =>
  s
    .replace(/\/\/[^\r\n]*/g, '')
    .replace(/import [\s\S]*?;/g, '')
    .replace(/mouthForward: [^,]+,/, '')
    .replace(/mouthHeight: [^,]+,/, '')
    .replace(/\s/g, '');
assert.equal(
  normalize(await readFile('shared/behemoth-rules.mts', 'utf8')),
  normalize(await readFile(`${dir}/retained-original/behemoth-rules.mts`, 'utf8')),
  'Only emission coordinates may change in gameplay tuning',
);
const { BEHEMOTH: R } = await import('../dist/shared/behemoth-rules.mjs');
assert.equal(R.mouthForward, numeric.mouth.mouthForward);
assert.equal(R.mouthHeight, numeric.mouth.mouthHeight);
const { behemothWindupMouth } = await import('../dist/shared/behemoth-mouth.mjs');
for (let i = 0; i < numeric.mouthWindup.length; i++) {
  const sampled = behemothWindupMouth(i / (numeric.mouthWindup.length - 1));
  assert.ok(Math.abs(sampled.forward - numeric.mouthWindup[i].forward) < 1e-12);
  assert.ok(Math.abs(sampled.height - numeric.mouthWindup[i].height) < 1e-12);
}
const qa = await json(`${dir}/game-qa.json`);
assert.deepEqual(qa.errors, []);
assert.ok(qa.samples.some((s) => s.enemy?.hash === asset.sha256));
const rendered = await json(
  `${asset.source.slice(0, -'candidate.glb'.length)}qa/render-manifest.json`,
);
assert.equal(rendered.sha256, asset.sha256);
assert.equal(rendered.fpsSetBeforeImport, true);
assert.equal(rendered.videos, true);
assert.equal(rendered.clips.length, 14);
assert.ok(rendered.clips.every((c) => c.views.length === 6));
const report = {
  sha256: asset.sha256,
  url: asset.url,
  retainedOriginal: old.url,
  existingGLBsUnchanged: baseline.files.length,
  fourLegRig: true,
  numeric240HzPass: true,
  gameplayUnchangedExceptMouth: true,
  exactGLBClips: 14,
  viewsPerClip: 6,
  gameChecks: qa.checks.length,
  errors: [],
  verifiedAt: new Date().toISOString(),
};
await writeFile(`${dir}/verification.json`, JSON.stringify(report, null, 2) + '\n');
if (process.argv[2]) {
  const origin = new URL(process.argv[2]);
  assert.ok(['127.0.0.1', 'localhost'].includes(origin.hostname));
  const health = await fetch(new URL('/api/health', origin));
  assert.equal(health.status, 200);
  const servedAsset = await fetch(new URL('/models/violet-behemoth/asset.json', origin)).then((r) =>
    r.json(),
  );
  assert.equal(servedAsset.sha256, asset.sha256);
  const served = await fetch(new URL(asset.url, origin)).then((r) => r.arrayBuffer());
  assert.equal(hash(Buffer.from(served)), asset.sha256);
  const emitter = await fetch(new URL('/shared/behemoth-mouth.mjs', origin)).then((r) => r.text());
  assert.ok(emitter.includes(asset.sha256));
  await writeFile(
    `${dir}/served.json`,
    JSON.stringify(
      {
        origin: origin.origin,
        healthStatus: health.status,
        url: asset.url,
        sha256: asset.sha256,
        bytes: served.byteLength,
        emitterModuleSha256: hash(Buffer.from(emitter)),
        checkedAt: new Date().toISOString(),
      },
      null,
      2,
    ) + '\n',
  );
  report.servedOrigin = origin.origin;
}
console.log(JSON.stringify(report));
