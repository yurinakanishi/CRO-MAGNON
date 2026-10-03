// Measure the delivered skin/animation buffers; texture decoding is omitted only
// for CPU inspection. The offline browser viewer loads the unchanged textured GLB.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { loadMotion, pose } from './motion-glb.mjs';
import { fastSkinPositions } from './fast-skin-positions.mjs';

const revision = process.argv[2] || '03';
// An explicit workspace permits later candidates without treating them as C1.
const base = process.argv[3] || 'output/model-generation/models/rimo-neko';
const file = `${base}/work/rig/revision-${revision}/candidate.glb`;
const lowDetail = process.argv.includes('--lod');
const out = `${base}/qa/rig-${revision}/${lowDetail ? 'lod-motion' : 'motion'}.json`;
const asset = JSON.parse(await readFile(`${base}/work/rig/revision-${revision}/process.json`, 'utf8'));
if (!asset.locomotionSpeedIsExported)
  for (const [name, gait] of Object.entries(asset.locomotion))
    gait.metresPerSecond *= (name === 'Walk_Loop' ? .68 : .48) / gait.cycleSeconds;
const gltf = await loadMotion(file),
  meshes = [];
gltf.scene.traverse((o) => {
  if (o.isSkinnedMesh) meshes.push(o);
});
let lodSha256;
if (lowDetail) {
  const low = await loadMotion(`${base}/work/rig/revision-${revision}/lod.glb`), lowMeshes = [];
  low.scene.traverse(o => { if (o.isSkinnedMesh) lowMeshes.push(o); });
  assert.equal(meshes.length, lowMeshes.length);
  for (const [i, mesh] of meshes.entries()) {
    const reduced = lowMeshes.find(m => m.name === mesh.name) ?? lowMeshes[i];
    assert.deepEqual(mesh.skeleton.bones.map(b => b.name), reduced.skeleton.bones.map(b => b.name));
    for (const [j, inverse] of mesh.skeleton.boneInverses.entries())
      assert.ok(inverse.elements.every((n, k) => Math.abs(n-reduced.skeleton.boneInverses[j].elements[k]) < 1e-6));
    assert.ok(mesh.matrixWorld.elements.every((n,k) => Math.abs(n-reduced.matrixWorld.elements[k]) < 1e-6));
    // Match production: keep the original animated skeleton and bind matrices.
    mesh.geometry = reduced.geometry;
  }
  lodSha256 = createHash('sha256').update(low.bytes).digest('hex');
}
const samplers = meshes.map(fastSkinPositions);
let maximumSamplerReferenceError = 0;
const checks = [];
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
      const points = samplers[mi].sample();
      if (step === 0 || step === Math.floor(steps * .37) || step === steps) {
        maximumSamplerReferenceError = Math.max(maximumSamplerReferenceError, samplers[mi].referenceError());
        assert.ok(maximumSamplerReferenceError < 1e-7, 'cached skin sampling agrees with Three.js');
      }
      for (let i = 0; i < points.length; i += 3) {
        const x = points[i], y = points[i + 1], z = points[i + 2];
        assert.ok(Number.isFinite(x + y + z));
        minimum = Math.min(minimum, y);
        if (step === 0) { first[mi][i] = x; first[mi][i + 1] = y; first[mi][i + 2] = z; }
        if (looping && step === steps)
          loopMaxError = Math.max(
            loopMaxError,
            Math.hypot(x - first[mi][i], y - first[mi][i + 1], z - first[mi][i + 2]),
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
      lodSha256,
      sampleHz: 'At least 120 Hz and twice each clip authoring rate, including between-key poses',
      maxWeightError,
      maximumSamplerReferenceError,
      checks,
      scope:
        'All exported vertices, including between-key poses; root/loop/paw stance checks. No exhaustive self-intersection proof.',
    },
    null,
    2,
  ) + '\n',
);
