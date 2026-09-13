import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as T from 'three';
import { loadMotion } from './motion-glb.mjs';
import { LocomotionGrounding } from '../dist/src/locomotion-grounding.js';

const revision = process.argv[2] || 'revision-10',
  results = [];
const keys = [
  'cro-magnon-woman',
  'cro-magnon-hunter',
  'neanderthal-woman',
  'neanderthal-hunter',
  'cat-kunoichi',
];
const v = () => new T.Vector3(),
  q = () => new T.Quaternion();
const hash = (b) => createHash('sha256').update(b).digest('hex');
const json = async (p) => JSON.parse(await readFile(p, 'utf8'));
for (const key of keys) {
  const dir = `output/player-gaits/${revision}/${key}`,
    asset = await json(dir + '/asset.json');
  const g = await loadMotion(dir + '/model.glb'),
    original = await loadMotion('public' + asset.humanLocomotion.sourceDelivery);
  assert.equal(hash(g.bytes), asset.sha256);
  assert.equal(hash(original.bytes), asset.humanLocomotion.sourceSha256);
  assert.ok(
    g.binary.subarray(0, original.binary.length).equals(original.binary),
    'original binary retained',
  );
  for (const field of ['nodes', 'skins', 'meshes', 'materials', 'textures', 'images'])
    assert.deepEqual(g.doc[field], original.doc[field], field);
  for (const a of original.doc.animations)
    if (!['Walk_Loop', 'Run_Loop'].includes(a.name))
      assert.deepEqual(
        g.doc.animations.find((b) => b.name === a.name),
        a,
        'unchanged ' + a.name,
      );
  const manifest = await json(`assets/human-locomotion/source-manifests/${key}.json`);
  assert.deepEqual(asset.spearThrust, manifest.spearThrust);
  const feet = { L: [], R: [] },
    surface = [],
    bones = [];
  g.scene.traverse((n) => {
    if (n.isBone) bones.push(n);
  });
  const rest = new Map(
    bones.map((b) => [
      b.name,
      { p: b.position.clone(), q: b.quaternion.clone(), s: b.scale.clone() },
    ]),
  );
  function restore() {
    for (const b of bones) {
      const r = rest.get(b.name);
      b.position.copy(r.p);
      b.quaternion.copy(r.q);
      b.scale.copy(r.s);
    }
    g.scene.updateMatrixWorld(true);
  }
  g.scene.traverse((mesh) => {
    if (!mesh.isSkinnedMesh) return;
    const a = mesh.geometry.attributes;
    for (let i = 0; i < a.position.count; i++) {
      const p = mesh.getVertexPosition(i, v()).applyMatrix4(mesh.matrixWorld);
      if (i % Math.max(1, Math.floor(a.position.count / 1200)) === 0) surface.push({ mesh, i });
      for (const side of ['L', 'R']) {
        let w = 0;
        for (let j = 0; j < 4; j++)
          if (
            ['Foot' + side, 'Toe' + side].includes(
              mesh.skeleton.bones[a.skinIndex.array[4 * i + j]].name,
            )
          )
            w += a.skinWeight.array[4 * i + j];
        if (w > 0.7) feet[side].push({ mesh, i, p });
      }
    }
  });
  for (const side of ['L', 'R']) {
    const min = Math.min(...feet[side].map((s) => s.p.y));
    feet[side] = feet[side].filter((s) => s.p.y < min + asset.heightMetres * 0.016);
  }
  const pos = (n) => g.scene.getObjectByName(n).getWorldPosition(v());
  function updateSkin() {
    g.scene.updateMatrixWorld(true);
    g.scene.traverse((n) => {
      if (n.isSkinnedMesh) n.skeleton.update();
    });
  }
  function inspect() {
    updateSkin();
    const soles = ['L', 'R'].map((side) =>
      Math.min(
        ...feet[side].map(
          (s) => s.mesh.getVertexPosition(s.i, v()).applyMatrix4(s.mesh.matrixWorld).y,
        ),
      ),
    );
    const knees = [],
      elbows = [],
      normal = [],
      lengths = [],
      hipAngles = [];
    for (const side of ['L', 'R']) {
      for (const [kind, up, low, tip] of [
        ['leg', 'UpperLeg', 'LowerLeg', 'Foot'],
        ['arm', 'UpperArm', 'LowerArm', 'Hand'],
      ]) {
        const a = pos(up + side),
          b = pos(low + side),
          c = pos(tip + side),
          upper = b.clone().sub(a),
          lower = c.clone().sub(b);
        const angle = T.MathUtils.radToDeg(upper.angleTo(lower));
        (kind === 'leg' ? knees : elbows).push(angle);
        lengths.push(upper.length(), lower.length());
        if (kind === 'leg') {
          normal.push(upper.clone().cross(lower).normalize().x);
          hipAngles.push(T.MathUtils.radToDeg(Math.atan2(upper.z, -upper.y)));
        }
      }
    }
    return {
      soles,
      knees,
      elbows,
      normal,
      lengths,
      hipAngles,
      pelvis: pos('Hips').y,
      rotations: bones.map((b) => b.quaternion.toArray()),
    };
  }
  const records = [];
  for (const name of ['Walk_Loop', 'Run_Loop']) {
    restore();
    const clip = g.animations.find((c) => c.name === name),
      mixer = new T.AnimationMixer(g.scene),
      action = mixer.clipAction(clip).setLoop(T.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();
    const count = Math.ceil(clip.duration * 240),
      samples = [];
    let first, last;
    for (let f = 0; f <= count; f++) {
      action.time = (clip.duration * f) / count;
      mixer.update(0);
      samples.push(inspect());
      if (f === 0 || f === count) {
        const points = surface.map((s) =>
          s.mesh.getVertexPosition(s.i, v()).applyMatrix4(s.mesh.matrixWorld),
        );
        if (!f) first = points;
        else last = points;
      }
    }
    const dt = clip.duration / count;
    const speeds = samples
      .slice(1)
      .map((s, i) =>
        s.rotations.map(
          (r, j) =>
            T.MathUtils.radToDeg(
              new T.Quaternion(...r).angleTo(new T.Quaternion(...samples[i].rotations[j])),
            ) / dt,
        ),
      );
    const metric = {
      minimumSoleY: Math.min(...samples.flatMap((s) => s.soles)),
      maximumLowestSoleY: Math.max(...samples.map((s) => Math.min(...s.soles))),
      flightFraction: samples.filter((s) => Math.min(...s.soles) > 0.012).length / samples.length,
      kneeDegrees: [
        Math.min(...samples.flatMap((s) => s.knees)),
        Math.max(...samples.flatMap((s) => s.knees)),
      ],
      elbowDegrees: [
        Math.min(...samples.flatMap((s) => s.elbows)),
        Math.max(...samples.flatMap((s) => s.elbows)),
      ],
      minimumForwardKneePlane: Math.min(...samples.flatMap((s) => s.normal)),
      maximumBoneLengthError: Math.max(
        ...samples.flatMap((s) => s.lengths.map((l, i) => Math.abs(l - samples[0].lengths[i]))),
      ),
      pelvisExcursion:
        Math.max(...samples.map((s) => s.pelvis)) - Math.min(...samples.map((s) => s.pelvis)),
      maxPelvisSpeed: Math.max(
        ...samples.slice(1).map((s, i) => Math.abs(s.pelvis - samples[i].pelvis) / dt),
      ),
      maxKneeDegreesPerSecond: Math.max(
        ...samples
          .slice(1)
          .flatMap((s, i) => s.knees.map((a, j) => Math.abs(a - samples[i].knees[j]) / dt)),
      ),
      maxLocalJointDegreesPerSecond: Math.max(...speeds.flat()),
      loopSurfaceError: Math.max(...first.map((p, i) => p.distanceTo(last[i]))),
    };
    console.log(key, name, JSON.stringify(metric));
    assert.ok(metric.minimumSoleY > -0.002, key + ' floor');
    assert.ok(metric.kneeDegrees[0] > 2 && metric.kneeDegrees[1] < 125, key + ' knee range');
    assert.ok(metric.elbowDegrees[0] > 1 && metric.elbowDegrees[1] < 135, key + ' elbow range');
    assert.ok(metric.minimumForwardKneePlane > 0.6, key + ' inverted knee');
    assert.ok(metric.maximumBoneLengthError < 1e-5, key + ' bone stretching');
    assert.ok(metric.loopSurfaceError < 1e-5, key + ' open loop');
    assert.ok(metric.maxKneeDegreesPerSecond < 1000, key + ' knee snap');
    assert.ok(metric.pelvisExcursion < asset.heightMetres * 0.09, key + ' pelvis excursion');
    assert.ok(
      name === 'Run_Loop' ? metric.flightFraction > 0.08 : metric.maximumLowestSoleY < 0.008,
      key + ' contact/flight',
    );
    records.push({ clip: name, seconds: clip.duration, sampleRate: 240, metric });
    mixer.stopAllAction();
    mixer.uncacheRoot(g.scene);
  }
  // Test normalized intermediate walk/run poses across the whole phase range.
  // This catches knee reversals hidden by inspecting isolated clip endpoints.
  restore();
  const grounding = new LocomotionGrounding(g.scene);
  let blendMinimum = Infinity,
    blendCorrectedMinimum = Infinity,
    blendMinimumKnee = Infinity;
  for (let phase = 0; phase < 1; phase += 1 / 32)
    for (const weight of [0.25, 0.5, 0.75]) {
      restore();
      const mixer = new T.AnimationMixer(g.scene),
        actions = new Map();
      for (const [name, w] of [
        ['Walk_Loop', 1 - weight],
        ['Run_Loop', weight],
      ]) {
        const clip = g.animations.find((c) => c.name === name),
          a = mixer.clipAction(clip).setEffectiveWeight(w).play();
        a.time = phase * clip.duration;
        actions.set(name, a);
      }
      mixer.update(0);
      const s = inspect();
      blendMinimum = Math.min(blendMinimum, ...s.soles);
      blendMinimumKnee = Math.min(blendMinimumKnee, ...s.knees);
      assert.ok(
        s.normal.every((n) => n > 0.5),
        'blend reverses knee',
      );
      grounding.apply(actions);
      const corrected = inspect();
      blendCorrectedMinimum = Math.min(blendCorrectedMinimum, ...corrected.soles);
      assert.ok(Math.min(...corrected.soles) > -0.001, 'blend floor correction');
      assert.deepEqual(corrected.rotations, s.rotations, 'grounding must not change joint angles');
      grounding.restore();
      mixer.stopAllAction();
      mixer.uncacheRoot(g.scene);
    }
  results.push({
    key,
    sha256: asset.sha256,
    records,
    blendMinimumSoleY: blendMinimum,
    blendCorrectedMinimumSoleY: blendCorrectedMinimum,
    blendMinimumKneeDegrees: blendMinimumKnee,
    unchangedOtherClips: original.doc.animations.length - 2,
  });
}
await writeFile(
  `output/player-gaits/${revision}/human-validation.json`,
  JSON.stringify({ status: 'passed', revision, results }, null, 2) + '\n',
);
