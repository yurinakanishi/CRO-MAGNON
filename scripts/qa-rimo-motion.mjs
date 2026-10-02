// Measure the delivered skin/animation buffers; texture decoding is omitted only
// for CPU inspection. The offline browser viewer loads the unchanged textured GLB.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { loadMotion, pose } from './motion-glb.mjs';

const revision = process.argv[2] || '03';
const base = 'output/model-generation/models/rimo-neko';
const file = `${base}/work/rig/revision-${revision}/candidate.glb`;
const out = `${base}/qa/rig-${revision}/motion.json`;
const asset = JSON.parse(await readFile(`${base}/work/rig/revision-${revision}/process.json`, 'utf8'));
if (!asset.locomotionSpeedIsExported)
  for (const [name, gait] of Object.entries(asset.locomotion))
    gait.metresPerSecond *= (name === 'Walk_Loop' ? .68 : .48) / gait.cycleSeconds;
const gltf = await loadMotion(file),
  meshes = [];
gltf.scene.traverse((o) => {
  if (o.isSkinnedMesh) meshes.push(o);
});
const v = new THREE.Vector3(),
  checks = [];
let maxWeightError = 0;
for (const m of meshes) {
  const w = m.geometry.attributes.skinWeight;
  for (let i = 0; i < w.count; i++)
    maxWeightError = Math.max(
      maxWeightError,
      Math.abs(w.getX(i) + w.getY(i) + w.getZ(i) + w.getW(i) - 1),
    );
}
assert.ok(maxWeightError < 1e-6);
for (const clip of gltf.animations) {
  const sampleHz = Math.max(120, 2 * (asset.clips.find(c => c.name === clip.name)?.fps ?? 60));
  const steps = Math.round(clip.duration * sampleHz),
    looping = clip.name.endsWith('_Loop');
  let minimum = Infinity,
    loopMaxError = 0,
    rootDrift = 0;
  const first = [],
    feet = {},
    maxStanceDrift = {};
  const fast = clip.name === 'Run_Loop',
    gait = asset.locomotion[clip.name];
  const offsets = gait?.touchdownPhases
    ? Object.fromEntries(Object.entries(gait.touchdownPhases).map(([k, t]) => [(k[0] === 'F' ? 'Hand' : 'Foot') + k[1], (1 - t) % 1]))
    : fast
    ? { HandL: 0, FootR: 0, HandR: 0.5, FootL: 0.5 }
    : { FootL: 0, HandL: 0.25, FootR: 0.5, HandR: 0.75 };
  const support = [], body = [];
  for (let step = 0; step <= steps; step++) {
    const time = (clip.duration * step) / steps,
      mixer = pose(gltf, clip, time);
    for (const [mi, m] of meshes.entries()) {
      if (step === 0) first[mi] = new Float32Array(m.geometry.attributes.position.count * 3);
      for (let i = 0; i < m.geometry.attributes.position.count; i++) {
        m.getVertexPosition(i, v);
        m.localToWorld(v);
        assert.ok(Number.isFinite(v.x + v.y + v.z));
        minimum = Math.min(minimum, v.y);
        if (step === 0) v.toArray(first[mi], i * 3);
        if (looping && step === steps)
          loopMaxError = Math.max(
            loopMaxError,
            v.distanceTo(new THREE.Vector3().fromArray(first[mi], i * 3)),
          );
      }
    }
    rootDrift = Math.max(rootDrift, gltf.scene.getObjectByName('Root').position.length());
    if (fast || clip.name === 'Hiss') {
      const joints = Object.fromEntries(['Hips', 'Spine', 'Chest', 'Head'].map((n) =>
        [n, gltf.scene.getObjectByName(n).getWorldPosition(new THREE.Vector3()).toArray()]));
      body.push({ time, joints });
      if (gait) support.push({time, planted:Object.entries(offsets).filter(([,o]) => (step/steps+o)%1<gait.dutyFactor).map(([n])=>n)});
    }
    if (gait)
      for (const [name, offset] of Object.entries(offsets)) {
        const phase = (step / steps + offset) % 1,
          p = gltf.scene.getObjectByName(name).getWorldPosition(new THREE.Vector3());
        p.z += gait.metresPerSecond * time;
        if (phase < gait.dutyFactor - 0.02 && phase > 0.02) {
          const previous = feet[name];
          if (previous && phase > previous.phase)
            maxStanceDrift[name] = Math.max(
              maxStanceDrift[name] || 0,
              Math.hypot(p.x - previous.p.x, p.z - previous.p.z),
            );
          else feet[name] = { p, phase };
        } else delete feet[name];
      }
    mixer.stopAllAction();
    mixer.uncacheRoot(gltf.scene);
  }
  assert.ok(minimum >= -0.001, `${clip.name}: floor ${minimum}`);
  assert.ok(rootDrift < 1e-6, `${clip.name}: root drift`);
  assert.ok(loopMaxError < 1e-5, `${clip.name}: loop seam`);
  if (gait)
    assert.ok(
      Object.values(maxStanceDrift).every((d) => d < 0.008),
      `${clip.name}: stance slide`,
    );
  const check = {
    clip: clip.name,
    seconds: clip.duration,
    sampleHz,
    samples: steps + 1,
    minimumY: minimum,
    rootDrift,
    loopMaxError,
    maxStanceDrift,
    support,
    body,
  };
  checks.push(check);
  console.log(JSON.stringify({ ...check, support: support.length, body: body.length }));
}
await mkdir(out.slice(0, out.lastIndexOf('/')), { recursive: true });
await writeFile(
  out,
  JSON.stringify(
    {
      file,
      sha256: createHash('sha256').update(gltf.bytes).digest('hex'),
      sampleHz: '120 Hz for unchanged clips; 480 Hz including between-key poses for revised clips',
      maxWeightError,
      checks,
      scope:
        'All exported vertices, including between-key poses; root/loop/paw stance checks. No exhaustive self-intersection proof.',
    },
    null,
    2,
  ) + '\n',
);
