// Adopt the user-requested four-legged variant; keep every existing GLB intact.
import { readFile, writeFile, mkdir, copyFile, readdir, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const key = 'violet-behemoth',
  variant = 'violet-behemoth-quadruped';
const revision = process.argv[2] ?? '04',
  gameQA = process.argv[3];
assert.match(revision, /^\d{2}$/);
const model = `output/model-generation/models/${variant}`;
const folder = `${model}/work/rig/revision-${revision}`,
  dest = `assets/${variant}`;
const json = async (p) => JSON.parse(await readFile(p, 'utf8'));
const save = (p, v) => writeFile(p, JSON.stringify(v, null, 2) + '\n');
const hash = (b) => createHash('sha256').update(b).digest('hex');
const process_ = await json(`${folder}/process.json`),
  numeric = await json(`${folder}/qa/numeric.json`);
const review = await json(`${dest}/visual-review.json`),
  baseline = await json(`${dest}/baseline.json`);
const bytes = await readFile(`${folder}/candidate.glb`),
  sha256 = hash(bytes);
assert.equal(numeric.numericPass, true);
assert.equal(numeric.sha256, sha256);
assert.equal(process_.sha256, sha256);
assert.equal(review.sha256, sha256);
assert.equal(review.decision, 'adopt');
assert.deepEqual(
  process_.clips.map((c) => c.name).sort(),
  (await json(`${model}/request-spec.json`)).clips.slice().sort(),
);
assert.ok(Math.abs(numeric.mouth.mouthSide) < 0.001, 'Emitter is centred on the skull');
const verifiedQA = gameQA ? await json(gameQA) : null;
if (verifiedQA) {
  assert.deepEqual(verifiedQA.errors, []);
  assert.ok(
    verifiedQA.samples.some((s) => s.enemy?.hash === sha256),
    'QA actually loaded this variant',
  );
}
for (const old of baseline.files)
  assert.equal(hash(await readFile(old.path)), old.sha256, `Retain ${old.path}`);
const url = `/models/${key}/model-quadruped-r${revision}.glb`;
if (
  await access(`public${url}`).then(
    () => true,
    () => false,
  )
)
  assert.equal(hash(await readFile(`public${url}`)), sha256);
else await writeFile(`public${url}`, bytes);
// Authoritative emission coordinates are measured from this exact GLB. Only
// the position changes; all attack selection, timing, range, speed and damage stay.
const release = { forward: numeric.mouth.mouthForward, height: numeric.mouth.mouthHeight };
if (
  !(await readFile('shared/behemoth-mouth.mts', 'utf8').catch(() => '')).includes(
    `SHA-256 ${sha256}.`,
  )
)
  await writeFile(
    'shared/behemoth-mouth.mts',
    `// Generated from ${url}, SHA-256 ${sha256}.\n// Midpoint of Head/Jaw front lip, measured from the exported animation.\nexport const BEHEMOTH_MOUTH_AT_RELEASE = ${JSON.stringify(release)} as const;\nconst WINDUP = ${JSON.stringify(numeric.mouthWindup, null, 2)} as const;\n\nexport function behemothWindupMouth(progress: number) {\n  const sample = Math.max(0, Math.min(1, progress)) * (WINDUP.length - 1);\n  const i = Math.min(WINDUP.length - 2, Math.floor(sample)), t = sample - i;\n  return {\n    forward: WINDUP[i].forward + (WINDUP[i + 1].forward - WINDUP[i].forward) * t,\n    height: WINDUP[i].height + (WINDUP[i + 1].height - WINDUP[i].height) * t,\n  };\n}\n`,
  );
let rules = await readFile('shared/behemoth-rules.mts', 'utf8');
const originalRules = rules;
const eol = rules.includes('\r\n') ? '\r\n' : '\n';
rules = rules.replace(
  '// Fictional creature tuning. Hind legs are vestigial; locomotion is forearm-driven.',
  '// Horned quadruped variant; four supporting legs. Gameplay tuning is retained.',
);
if (!rules.includes("from './behemoth-mouth.mjs'"))
  rules = rules.replace(
    'import { HEARING }',
    `import { BEHEMOTH_MOUTH_AT_RELEASE } from './behemoth-mouth.mjs';${eol}import { HEARING }`,
  );
rules = rules.replace(
  /  \/\/ Original GLB mouth aperture[^\r\n]*/,
  '  // Four-legged GLB mouth aperture at authored Spit 0.18 s (game release 144 ms).',
);
rules = rules.replace(
  /  mouthForward: [^,]+,/,
  '  mouthForward: BEHEMOTH_MOUTH_AT_RELEASE.forward,',
);
rules = rules.replace(/  mouthHeight: [^,]+,/, '  mouthHeight: BEHEMOTH_MOUTH_AT_RELEASE.height,');
rules = rules.replace(
  '// The grounded r10 poses stay intact.',
  '// Both retained r10 and the quadruped use these authored attack durations.',
);
if (rules !== originalRules) await writeFile('shared/behemoth-rules.mts', rules);
const original = await json(`${dest}/retained-original/asset.json`);
const referenceImage = `assets/${variant}/source/reference-v1.png`;
const asset = {
  modelKey: key,
  name: original.name,
  kind: 'enemy',
  variant,
  candidate: 1,
  revision,
  status: gameQA ? 'integrated-and-game-qa-passed' : 'integrated-browser-qa-pending',
  url,
  sha256,
  bytes: bytes.length,
  triangles: process_.triangles,
  upAxis: 'Y',
  forwardAxis: '+Z',
  heightMetres: process_.heightMetres,
  widthMetres: process_.widthMetres,
  lengthMetres: process_.lengthMetres,
  bones: process_.bones.length,
  clips: process_.clips,
  locomotion: process_.locomotion,
  lods: [],
  placement: {
    pivot: 'ground-body-centred',
    min: numeric.restBounds.min,
    max: numeric.restBounds.max,
  },
  source: `${folder}/candidate.glb`,
  retainedOriginal: { url: original.url, sha256: original.sha256, active: false },
  provenance: {
    provider:
      'Codex built-in imagegen -> local TRELLIS-2 -> measured reduction -> four-leg IK and seven-link tail rig by Codex',
    claudeUsed: false,
    referenceImage,
    referenceSha256: hash(await readFile(referenceImage)),
    visualReview: `${dest}/visual-review.json`,
  },
  notes: [
    process_.geometryOrigin,
    process_.motionNotes,
    'Original r10 and all previous deliveries retained byte-for-byte, unused by the active catalog.',
  ],
};
const catalog = await json('public/models/world-assets.json');
assert.ok(catalog.assets.some((a) => a.modelKey === key));
catalog.assets[catalog.assets.findIndex((a) => a.modelKey === key)] = asset;
const models = await json('assets/world-models.json'),
  index = models.assets.findIndex((a) => a.key === key);
assert.ok(index >= 0);
models.assets[index] = {
  ...models.assets[index],
  variant,
  height: asset.heightMetres,
  length: asset.lengthMetres,
  status: asset.status,
  sha256,
  delivery: url,
  gameQA: `${dest}/game-qa.json`,
  subject:
    'Horned purple giant with four functional supporting legs, broad jaws and a flexible seven-link tail; same territorial attacks and tuning.',
};
await save('public/models/world-assets.json', catalog);
await save('assets/world-models.json', models);
await save(`public/models/${key}/asset.json`, asset);
await save(`${dest}/numeric.json`, numeric);
await save(`${dest}/rig.json`, process_);
await copyFile(`${model}/request-spec.json`, `${dest}/request-spec.json`);
await copyFile(`${model}/work/trellis/dense-res1024-seed0042.json`, `${dest}/reconstruction.json`);
await copyFile(`${model}/work/low-poly/revision-01/process.json`, `${dest}/reduction.json`);
await mkdir(`${dest}/workflow/candidate-01`, { recursive: true });
for (const file of await readdir(`${model}/workflow/candidate-01`))
  if (file.endsWith('.py'))
    await copyFile(
      `${model}/workflow/candidate-01/${file}`,
      `${dest}/workflow/candidate-01/${file}`,
    );
if (verifiedQA) await save(`${dest}/game-qa.json`, verifiedQA);
await save(`${dest}/delivery.json`, {
  adoptedAt: new Date().toISOString(),
  url,
  sha256,
  bytes: bytes.length,
  revision,
  originalRetained: asset.retainedOriginal,
  existingGLBsUnchanged: baseline.files.length,
  numericPass: true,
  status: asset.status,
});
console.log(JSON.stringify({ url, sha256, bytes: bytes.length, status: asset.status }));
