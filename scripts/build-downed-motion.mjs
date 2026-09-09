// Append an authored, grounded skeletal collapse to the current delivered skins.
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { loadMotion, pack } from './motion-glb.mjs';
import { RidingPose } from '../dist/src/riding-pose.js';
import { CHARACTER_MODELS } from '../dist/shared/characters.mjs';

const base = 'output/downed-motion';
const hash = (b) => createHash('sha256').update(b).digest('hex');
const smooth = (x) => x * x * (3 - 2 * x);
const results = [];
for (const { key } of CHARACTER_MODELS) {
  const folder = `${base}/${key}`;
  await mkdir(folder, { recursive: true });
  const current = JSON.parse(await readFile(`public/models/${key}/asset.json`, 'utf8'));
  const asset = current.downedMotion
    ? JSON.parse(await readFile(`assets/downed-motion/source-manifests/${key}.json`, 'utf8'))
    : current;
  const source = 'public' + asset.url;
  const gltf = await loadMotion(source);
  const { scene, doc, binary } = gltf;
  if (doc.animations.some((a) => a.name === 'Downed')) throw Error('Already authored: ' + key);
  await copyFile(source, `${folder}/source.glb`);
  await writeFile(`${folder}/source-asset.json`, JSON.stringify(asset, null, 2));
  const rig = new RidingPose(scene);
  const bones = [...rig.bones.values()].map((r) => r.bone);
  const capture = () => bones.map((b) => ({ p: b.position.clone(), q: b.quaternion.clone() }));
  const meshes = [];
  scene.traverse((m) => {
    if (m.isSkinnedMesh) meshes.push(m);
  });
  const point = new THREE.Vector3();
  const bounds = () => {
    scene.updateMatrixWorld(true);
    let min = Infinity,
      max = -Infinity;
    for (const m of meshes) {
      m.skeleton.update();
      for (let i = 0; i < m.geometry.attributes.position.count; i++) {
        m.getVertexPosition(i, point).applyMatrix4(m.matrixWorld);
        min = Math.min(min, point.y);
        max = Math.max(max, point.y);
      }
    }
    return { min, max };
  };
  const moveHips = (y, z = 0) => {
    const world = rig.hips.getWorldPosition(new THREE.Vector3());
    world.y += y;
    world.z += z;
    rig.hips.position.copy(rig.hips.parent.worldToLocal(world));
    scene.updateMatrixWorld(true);
  };
  const mixer = new THREE.AnimationMixer(scene);
  mixer.clipAction(gltf.animations.find((a) => a.name === 'Idle_Loop')).play();
  mixer.update(0);
  const idle = capture();
  mixer.stopAllAction();
  // Times give the knees a clear contact beat before the torso drops.
  const keys = [{ t: 0, transforms: idle }];
  function authored(t, thigh, shin, torso, arm, forearm, hipPitch, head) {
    rig.restore();
    scene.updateMatrixWorld(true);
    scene.getWorldQuaternion(rig.rootQ);
    const hipWorld = rig.hips.getWorldQuaternion(new THREE.Quaternion());
    hipWorld.premultiply(
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), hipPitch),
    );
    rig.hips.quaternion.copy(
      rig.hips.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(hipWorld),
    );
    scene.updateMatrixWorld(true);
    rig.aim('Spine', 0, ...torso);
    rig.aim('Chest', 0, ...torso);
    rig.aim('Neck', 0.08 * hipPitch, ...head);
    for (const [side, sign] of [
      ['L', 1],
      ['R', -1],
    ]) {
      rig.aim('UpperLeg' + side, sign * 0.07, ...thigh);
      rig.aim('LowerLeg' + side, 0, ...shin);
      rig.aim('Foot' + side, sign * 0.04, -0.05, t < 0.4 ? 1 : -1);
      rig.aim('UpperArm' + side, sign * 0.3, ...arm);
      rig.aim('LowerArm' + side, sign * -0.1, ...forearm);
    }
    // The mage's tail must lose support too, instead of pointing up from prone hips.
    if (rig.bones.has('Tail01') && t > 1) {
      rig.aim('Tail01', 0.65, -0.15, -1);
      rig.aim('Tail02', 0.8, -0.08, -1);
      rig.aim('Tail03', 1, -0.02, -0.7);
    }
    keys.push({ t, transforms: capture() });
  }
  authored(0.2, [-0.85, 0.52], [-0.85, -0.52], [1, 0.16], [-1, 0.12], [-0.75, 0.5], 0.1, [1, 0.24]);
  authored(0.65, [-1, 0.1], [-0.04, -1], [1, 0.24], [-0.95, 0.4], [-0.6, 0.85], 0.15, [0.8, 0.5]);
  authored(0.86, [-1, 0.06], [-0.04, -1], [0.85, 0.5], [-0.7, 0.7], [-0.45, 1], 0.25, [0.55, 0.8]);
  authored(1.35, [-0.28, -1], [-0.07, -1], [0.15, 1], [-0.4, 0.85], [-0.05, 1], 1.3, [0.08, 1]);
  authored(1.58, [-0.12, -1], [-0.04, -1], [0.03, 1], [-0.17, 0.8], [-0.01, 1], 1.48, [-0.12, 1]);
  authored(1.8, [-0.12, -1], [-0.04, -1], [0.055, 1], [-0.16, 0.8], [-0.01, 1], 1.46, [-0.08, 1]);
  const times = [],
    tracks = bones.map(() => ({ rotation: [], translation: [] })),
    samples = [];
  for (let frame = 0; frame <= 108; frame++) {
    const t = frame / 60;
    const index = Math.max(0, keys.findIndex((k) => k.t >= t) - 1);
    const a = keys[index],
      b = keys[index + 1];
    const u = smooth(Math.max(0, Math.min(1, (t - a.t) / (b.t - a.t))));
    bones.forEach((bone, i) => {
      bone.position.copy(a.transforms[i].p).lerp(b.transforms[i].p, u);
      bone.quaternion.copy(a.transforms[i].q).slerp(b.transforms[i].q, u);
    });
    // Ground the actual deformed surface, including broad feet, clothing and tail.
    const before = bounds();
    moveHips(0.004 - before.min);
    const measured = bounds();
    samples.push({
      t,
      ...measured,
      hips: rig.hips.getWorldPosition(new THREE.Vector3()).toArray(),
    });
    times.push(t);
    bones.forEach((bone, i) => {
      tracks[i].rotation.push(...bone.quaternion.toArray());
      tracks[i].translation.push(...bone.position.toArray());
    });
  }
  const chunks = [binary];
  let byteLength = binary.length;
  function accessor(values, type) {
    const data = Buffer.from(new Float32Array(values).buffer);
    const bufferView = doc.bufferViews.length;
    doc.bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: data.length });
    chunks.push(data);
    byteLength += data.length;
    const item = {
      bufferView,
      componentType: 5126,
      count: values.length / { SCALAR: 1, VEC3: 3, VEC4: 4 }[type],
      type,
    };
    if (type === 'SCALAR') {
      item.min = [0];
      item.max = [1.8];
    }
    doc.accessors.push(item);
    return doc.accessors.length - 1;
  }
  const input = accessor(times, 'SCALAR'),
    animation = { name: 'Downed', channels: [], samplers: [] };
  bones.forEach((bone, i) => {
    const node = doc.nodes.findIndex(
      (n) => THREE.PropertyBinding.sanitizeNodeName(n.name || '') === bone.name,
    );
    if (node < 0) throw Error('Unknown bone ' + bone.name);
    for (const [path, type] of [
      ['rotation', 'VEC4'],
      ['translation', 'VEC3'],
    ]) {
      const output = accessor(tracks[i][path], type),
        sampler = animation.samplers.length;
      animation.samplers.push({ input, output, interpolation: 'LINEAR' });
      animation.channels.push({ sampler, target: { node, path } });
    }
  });
  doc.animations.push(animation);
  doc.buffers[0].byteLength = byteLength;
  const bytes = pack(doc, Buffer.concat(chunks));
  await writeFile(`${folder}/model-downed-r01.glb`, bytes);
  const next = {
    ...asset,
    url: `/models/${key}/model-downed-r01.glb`,
    bytes: bytes.length,
    sha256: hash(bytes),
    clips: [...asset.clips, { name: 'Downed', seconds: 1.8, loop: false }],
    downedMotion: {
      revision: 'revision-01',
      sourceUrl: asset.url,
      sourceSha256: asset.sha256,
      clip: 'Downed',
      seconds: 1.8,
      fps: 60,
      review: 'assets/downed-motion/README.md',
    },
  };
  await writeFile(`${folder}/asset.json`, JSON.stringify(next, null, 2) + '\n');
  results.push({ key, source, sourceSha256: hash(gltf.bytes), sha256: hash(bytes), samples });
  console.log(key + ': authored Downed, ' + bytes.length + ' bytes');
}
await writeFile(
  `${base}/authoring.json`,
  JSON.stringify({ duration: 1.8, fps: 60, results }, null, 2) + '\n',
);
