import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
const read = async p => JSON.parse(await readFile(p, 'utf8'));
const save = (p, v) => writeFile(p, JSON.stringify(v, null, 2) + '\n');
const base = 'output/model-generation/models/rimo-neko/candidate-2/qa/rig-03';
const out = 'output/rimo-neko-c2-r03-game', qa = 'assets/rimo-neko/qa';
await mkdir(qa, { recursive: true });
const [motion, low, happy, preservation, alignment, browser, captures, records, asset, adoption, delivery] = await Promise.all([
  read(base + '/motion.json'), read(base + '/lod-motion.json'), read(base + '/happy-contact.json'),
  read(base + '/preservation.json'), read(base + '/straightening.json'), read(base + '/browser/result.json'),
  read(out + '/captures.json'), read(out + '/records.json'), read('public/models/rimo-neko/asset.json'),
  read('assets/rimo-neko/adoption.json'), read(out + '/delivery.json'),
]);
assert.equal(adoption.revision, '03');
for (const check of [motion, low, happy, preservation, alignment]) assert.equal(check.sha256, asset.sha256);
assert.equal(alignment.status, 'passed');
assert.equal(browser.sourceSha256, asset.sha256);
assert.equal(browser.capturesSaved, 126);
assert.deepEqual(browser.errors, []);
const frames = records.flatMap(r => r.frames), clips = [...new Set(frames.map(f => f.cat.clip))].sort();
assert.deepEqual(clips, asset.clips.map(c => c.name).sort());
for (const f of [...frames, ...captures]) {
  assert.equal(f.sha256, asset.sha256);
  assert.deepEqual(f.errors, []);
}
assert.ok(captures.some(c => c.lod === 1 && c.view === 'far'));
assert.ok(captures.some(c => c.lod === 0 && c.view === 'near'));
assert.ok(captures.some(c => c.view === 'normal'));
assert.ok(captures.some(c => c.cat.floor === .3));
const five = captures.filter(c => c.players === 5);
assert.equal(new Set(five.map(c => c.id)).size, 2);
for (const c of five) {
  assert.equal(c.peers.length, 3);
  assert.ok(c.peers.every(p => p.players === 5));
}
const returned = captures.findLast(c => Math.hypot(c.cat.position[0] - 51, c.cat.position[2] - 53) < .01 && c.followPlayerId === null);
assert.ok(returned, 'Return to camp must complete');
assert.ok(frames.some(f => f.cat.reaction === 'happy' && f.cat.hearts > 0));
// Use the repeated stroke with the cat already near each person. Keep the
// first approach's background-tab interpolation gap visible in the report.
const settled = [[1, 'cro-magnon-woman'], [3, 'maruimo-octopus']].map(([index, character]) => {
  const samples = records[index].frames.filter(f => f.cat.reaction === 'pet' && f.petWeight > .999);
  assert.ok(samples.length);
  const maxContactGap = Math.max(...samples.map(f => f.contactGap));
  assert.ok(maxContactGap < .045);
  return { record: index, character, samples: samples.length, maxContactGap };
});
const firstApproachGap = Math.max(...records[0].frames.filter(f => f.petWeight > .999).map(f => f.contactGap));
const joined = await read(out + '/rejoin.json');
assert.equal(joined.beforeId, joined.afterId);
assert.equal(joined.sha256, asset.sha256);
assert.equal(joined.players, 5);
assert.ok(delivery.checks.every(c => c.match));
assert.ok(delivery.checks.some(c => c.sha256 === asset.sha256));
const testLog = await readFile('output/rimo-straight-tests.log', 'utf8');
assert.match(testLog, /pass 860/);
assert.match(testLog, /fail 0/);
const summary = {
  candidate: 2, surface: '01', revision: '03', sha256: asset.sha256, status: 'passed',
  browserScreens: 2, protocolPeers: 3, allSevenClipsObserved: clips,
  recordings: records.length, renderedFrames: frames.length, captures: captures.length,
  settledPetContact: settled, firstApproachMaximumContactGap: firstApproachGap,
  maximumHeartsObserved: Math.max(...frames.map(f => f.cat.hearts)),
  excludedVisualCaptures: [
    { file: out + '/1790989536844-front.png', reason: 'Observer avatar obstructs the cat; replaced by the unobstructed front capture.' },
    { file: out + '/1790989956170-normal.png', reason: 'The canvas buffer is cleared outside the render callback; black saved PNG. Normal camera was verified separately in a live CUA browser screenshot after rejoin.' },
  ],
  checks: ['front-facing head and centred tail', 'high and low geometry', 'Pet → Happy with hearts → follow',
    'walk/run/deceleration', 'Hit → Hiss', 'bridge floor', 'return to camp through game button',
    'two screens and three protocol peers', 'reload and rejoin with the same observer id', 'normal camera'],
  methods: 'CUA-operated actual game pet/return buttons on a local memory-only server. Placement, character, follow destination, bridge and hit use explicit QA fixtures. The production GLB and renderer are used.',
  limitations: [
    'Background browser rendering is throttled between automation actions. This is not a sustained FPS measurement. The first approach has interpolation lag; settled strokes are reported separately.',
    'Sparse rendered samples observe at most four of the five staggered hearts at once; no claim is made that every particle lifetime was captured.',
    'No physical controller/device, small viewport, long-duration run or exhaustive self-intersection validation in this correction.',
  ],
  evidence: { captures: out + '/captures.json', records: out + '/records.json', delivery: out + '/delivery.json', rejoin: out + '/rejoin.json' },
};
await save(out + '/result.json', summary);
await save(qa + '/c2-r03-game.json', summary);
await save(qa + '/c2-r03-delivery.json', delivery);
await save(qa + '/c2-r03-alignment.json', alignment);
await save(qa + '/c2-r03-preservation.json', preservation);
await save(qa + '/c2-r03-motion-summary.json', {
  sha256: asset.sha256, allVertexPosesPerLOD: motion.checks.reduce((n, c) => n + c.samples, 0),
  high: motion.checks.map(({ body, support, ...c }) => c), low: low.checks.map(({ body, support, ...c }) => c),
  maximumSamplerReferenceError: Math.max(motion.maximumSamplerReferenceError, low.maximumSamplerReferenceError), happy,
});
// These unobstructed front/back captures were visually reviewed before copying.
await copyFile(out + '/1790989784156-front.png', qa + '/c2-r03-front-in-game.png');
await copyFile(out + '/1790989786153-back.png', qa + '/c2-r03-back-in-game.png');
Object.assign(adoption, {
  gameValidation: 'passed', gameQA: qa + '/c2-r03-game.json', alignmentQA: qa + '/c2-r03-alignment.json',
  allVertexPosesPerLOD: motion.checks.reduce((n, c) => n + c.samples, 0), testedLODs: 2, motionFramesReviewed: 126,
  tests: { passed: 860, failed: 0, log: 'output/rimo-straight-tests.log' },
  localServerQA: qa + '/c2-r03-delivery.json', knownLimits: summary.limitations,
});
await save('assets/rimo-neko/adoption.json', adoption);
console.log(JSON.stringify({ sha256: asset.sha256, clips: clips.length, frames: frames.length, captures: captures.length, settled }));
