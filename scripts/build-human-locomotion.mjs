import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as T from 'three';
import { loadMotion, pack } from './motion-glb.mjs';
import { readCmu, headingFor } from './cmu-motion.mjs';

export const HUMAN_KEYS = [
  'cro-magnon-woman',
  'cro-magnon-hunter',
  'neanderthal-woman',
  'neanderthal-hunter',
  'cat-kunoichi',
];
const revision = process.argv[2] || 'revision-10',
  only = process.argv[3];
const out = `output/player-gaits/${revision}`;
const v = () => new T.Vector3(),
  q = () => new T.Quaternion();
const hash = (b) => createHash('sha256').update(b).digest('hex');
const json = async (p) => JSON.parse(await readFile(p, 'utf8'));
const write = (p, a) => writeFile(p, JSON.stringify(a, null, 2) + '\n');
function frame(direction, axis = new T.Vector3(1, 0, 0)) {
  const y = direction.clone().normalize();
  const x = axis.clone().addScaledVector(y, -axis.dot(y)).normalize();
  assert.ok(x.length() > 0.9, 'anatomical frame must be nonsingular');
  return q().setFromRotationMatrix(new T.Matrix4().makeBasis(x, y, x.clone().cross(y)));
}
function worldRotate(bone, desired) {
  bone.quaternion.copy(bone.parent.getWorldQuaternion(q()).invert().multiply(desired));
  bone.updateMatrixWorld(true);
}
const sources = [];
for (const spec of [
  { name: 'Walk_Loop', trial: '35_01', start: 139, end: 273, duty: 0.61 },
  { name: 'Run_Loop', trial: '09_01', start: 0, end: 88, offset: 80, duty: 0.36 },
]) {
  const motion = await readCmu(spec.trial);
  const heading = headingFor(motion.poses, spec.start, spec.end);
  const span = spec.end - spec.start;
  const samples = [];
  for (let f = 0; f < span; f++) {
    const phase = f / span,
      p = motion.poses[spec.start + f];
    const trajectory = motion.poses[spec.start]
      .get('root')
      .p.clone()
      .lerp(motion.poses[spec.end].get('root').p, phase);
    trajectory.y = 0;
    const points = new Map();
    for (const [name, b] of p)
      points.set(name, {
        p: b.p.clone().sub(trajectory).applyQuaternion(heading),
        end: b.end.clone().sub(trajectory).applyQuaternion(heading),
        q: heading.clone().multiply(b.q),
      });
    samples.push(points);
  }
  // Periodic Gaussian filtering removes marker noise and blends the two cycle
  // boundaries; it does not invent independent sine waves for the limbs.
  const filtered = samples.map((_, f) => {
    const result = new Map();
    for (const name of samples[0].keys()) {
      const p = v(),
        end = v();
      let orientation,
        total = 0;
      for (let d = -5; d <= 5; d++) {
        const w = Math.exp((-d * d) / 8),
          s = samples[(f + d + span) % span].get(name);
        p.addScaledVector(s.p, w);
        end.addScaledVector(s.end, w);
        if (!orientation) orientation = s.q.clone();
        else orientation.slerp(s.q, w / (total + w));
        total += w;
      }
      result.set(name, { p: p.divideScalar(total), end: end.divideScalar(total), q: orientation });
    }
    return result;
  });
  const distance = motion.poses[spec.end]
    .get('root')
    .p.distanceTo(motion.poses[spec.start].get('root').p);
  sources.push({
    ...spec,
    ...motion,
    samples: filtered.map((_, f) => filtered[(f + (spec.offset || 0)) % span]),
    duration: span / 120,
    distance,
  });
}

await mkdir('assets/human-locomotion/source-manifests', { recursive: true });
for (const key of HUMAN_KEYS) {
  if (only && only !== key) continue;
  const sourceFile = `assets/human-locomotion/source-manifests/${key}.json`;
  try {
    await copyFile(`public/models/${key}/asset.json`, sourceFile, 1);
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
  }
  const asset = await json(sourceFile),
    g = await loadMotion(`public${asset.url}`);
  assert.equal(hash(g.bytes), asset.sha256);
  const { doc, binary } = g,
    bones = [];
  g.scene.traverse((b) => {
    if (b.isBone) bones.push(b);
  });
  const bone = (n) => g.scene.getObjectByName(n),
    hips = bone('Hips');
  const rest = new Map(
    bones.map((b) => [
      b.name,
      {
        p: b.position.clone(),
        q: b.quaternion.clone(),
        s: b.scale.clone(),
        wp: b.getWorldPosition(v()),
        wq: b.getWorldQuaternion(q()),
      },
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
  function direct(name, child, direction, axis) {
    const r = rest.get(name),
      from = rest.get(child).wp.clone().sub(r.wp);
    worldRotate(bone(name), frame(direction, axis).multiply(frame(from).invert()).multiply(r.wq));
  }
  const legs = ['L', 'R'].map((side) => {
    const upper = bone('UpperLeg' + side),
      lower = bone('LowerLeg' + side),
      foot = bone('Foot' + side);
    return {
      side,
      upper,
      lower,
      foot,
      a: upper.getWorldPosition(v()).distanceTo(lower.getWorldPosition(v())),
      b: lower.getWorldPosition(v()).distanceTo(foot.getWorldPosition(v())),
      sole: [],
    };
  });
  g.scene.traverse((mesh) => {
    if (!mesh.isSkinnedMesh) return;
    const a = mesh.geometry.attributes;
    for (let i = 0; i < a.position.count; i++) {
      const p = mesh.getVertexPosition(i, v()).applyMatrix4(mesh.matrixWorld);
      for (const leg of legs) {
        let weight = 0;
        for (let j = 0; j < 4; j++)
          if (
            ['Foot' + leg.side, 'Toe' + leg.side].includes(
              mesh.skeleton.bones[a.skinIndex.array[4 * i + j]].name,
            )
          )
            weight += a.skinWeight.array[4 * i + j];
        if (weight > 0.7 && p.y < asset.heightMetres * 0.1) leg.sole.push({ mesh, i, p });
      }
    }
  });
  for (const l of legs) {
    const min = Math.min(...l.sole.map((s) => s.p.y));
    l.sole = l.sole.filter((s) => s.p.y < min + asset.heightMetres * 0.016);
  }
  function updateSkin() {
    g.scene.updateMatrixWorld(true);
    g.scene.traverse((n) => {
      if (n.isSkinnedMesh) n.skeleton.update();
    });
  }
  function lowest(l) {
    return Math.min(
      ...l.sole.map((s) => s.mesh.getVertexPosition(s.i, v()).applyMatrix4(s.mesh.matrixWorld).y),
    );
  }
  const chunks = [binary];
  let byteLength = binary.length;
  function accessor(values, type, duration) {
    const data = Buffer.from(new Float32Array(values).buffer),
      bufferView = doc.bufferViews.length;
    doc.bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: data.length });
    chunks.push(data);
    byteLength += data.length;
    const a = {
      bufferView,
      componentType: 5126,
      count: values.length / { SCALAR: 1, VEC3: 3, VEC4: 4 }[type],
      type,
    };
    if (type === 'SCALAR') {
      a.min = [0];
      a.max = [duration];
    }
    return doc.accessors.push(a) - 1;
  }
  const changes = [];
  for (const source of sources) {
    const legScale =
      legs.reduce((s, l) => s + l.a + l.b, 0) /
      ['lfemur', 'ltibia', 'rfemur', 'rtibia'].reduce((s, n) => s + source.bones.get(n).length, 0);
    const poses = [];
    for (let f = 0; f < source.samples.length; f++) {
      restore();
      const p = source.samples[f];
      const hipCentre = p
        .get('lfemur')
        .p.clone()
        .add(p.get('rfemur').p)
        .multiplyScalar(0.5 * legScale);
      hipCentre.z += rest.get('Hips').wp.z;
      hips.position.copy(hips.parent.worldToLocal(hipCentre));
      worldRotate(hips, p.get('root').q.clone().multiply(rest.get('Hips').wq));
      const direction = (n) => p.get(n).end.clone().sub(p.get(n).p).normalize();
      for (const [name, child, cmu] of [
        ['Spine', 'Chest', 'upperback'],
        ['Chest', 'Neck', 'thorax'],
        ['Neck', 'Head', 'upperneck'],
      ]) {
        direct(name, child, direction(cmu), new T.Vector3(1, 0, 0).applyQuaternion(p.get(cmu).q));
      }
      // Head follows captured orientation at a modest amplitude, keeping gaze stable.
      worldRotate(bone('Head'), q().slerp(p.get('head').q, 0.45).multiply(rest.get('Head').wq));
      for (const l of legs) {
        const side = l.side,
          prefix = side.toLowerCase();
        const axis = new T.Vector3(1, 0, 0)
          .applyQuaternion(source.bones.get(prefix + 'tibia').axis)
          .applyQuaternion(p.get(prefix + 'femur').q);
        if (axis.x < 0) axis.negate();
        direct('UpperLeg' + side, 'LowerLeg' + side, direction(prefix + 'femur'), axis);
        direct('LowerLeg' + side, 'Foot' + side, direction(prefix + 'tibia'), axis);
        // Foot pitch comes from the captured ankle-to-ball segment. Correct the
        // different rest pitch of the model's ankle/toe geometry in its frame.
        direct('Foot' + side, 'Toe' + side, direction(prefix + 'foot'), axis);
        const toe = bone('Toe' + side),
          toeRest = rest.get(toe.name);
        const toeDirection = new T.Vector3(0, 1, 0).applyQuaternion(toeRest.wq);
        const toeDesired = frame(direction(prefix + 'toes'), axis)
          .multiply(frame(toeDirection).invert())
          .multiply(toeRest.wq);
        worldRotate(toe, toe.getWorldQuaternion(q()).slerp(toeDesired, 0.7));
        const upper = direction(prefix + 'humerus'),
          lower = direction(prefix + 'radius');
        // These stylized rigs place the shoulder centre further inward than the
        // captured adult's. Open the arm's swing plane to clear the actual torso;
        // keep its measured forward/back swing and elbow flexion continuous.
        const sign = side === 'L' ? 1 : -1;
        upper.x += sign * (key.endsWith('hunter') ? 0.1 : 0.27);
        lower.x += sign * (key.endsWith('hunter') ? 0.04 : 0.12);
        upper.normalize();
        lower.normalize();
        const armAxis = lower.clone().cross(upper).normalize();
        if (armAxis.x < 0) armAxis.negate();
        direct('UpperArm' + side, 'LowerArm' + side, upper, armAxis);
        direct('LowerArm' + side, 'Hand' + side, lower, armAxis);
        // The capture's unmeasured finger channels are intentionally unused.
        bone('Hand' + side).quaternion.copy(rest.get('Hand' + side).q);
      }
      updateSkin();
      const height = Math.min(...legs.map(lowest));
      const phase = f / source.samples.length;
      // Contact intervals follow the captured gait; the pelvis follows the
      // supporting sole. A small authored flight arc provides skin clearance.
      const local = phase % 0.5;
      const flight =
        source.name === 'Run_Loop' && local > source.duty
          ? Math.sin((Math.PI * (local - source.duty)) / (0.5 - source.duty)) *
            asset.heightMetres *
            0.018
          : 0;
      const correction = 0.003 + flight - height;
      hips.position.add(
        new T.Vector3(0, correction, 0).applyQuaternion(
          hips.parent.getWorldQuaternion(q()).invert(),
        ),
      );
      updateSkin();
      poses.push(
        new Map(
          bones.map((b) => [
            b.name,
            {
              translation: b.position.toArray(),
              rotation: b.quaternion.toArray(),
              scale: b.scale.toArray(),
            },
          ]),
        ),
      );
    }
    const count = poses.length,
      tracks = new Map(bones.map((b) => [b.name, { translation: [], rotation: [], scale: [] }]));
    for (let f = 0; f <= count; f++)
      for (const b of bones) {
        const pose = poses[f % count].get(b.name),
          track = tracks.get(b.name);
        track.translation.push(...pose.translation);
        track.scale.push(...pose.scale);
        const r = new T.Quaternion(...pose.rotation);
        if (track.rotation.length && r.dot(new T.Quaternion(...track.rotation.slice(-4))) < 0)
          r.set(-r.x, -r.y, -r.z, -r.w);
        track.rotation.push(...r.toArray());
      }
    const input = accessor(
      Array.from({ length: count + 1 }, (_, f) => (source.duration * f) / count),
      'SCALAR',
      source.duration,
    );
    const replacement = { name: source.name, channels: [], samplers: [] };
    for (const b of bones)
      for (const [property, type] of [
        ['translation', 'VEC3'],
        ['rotation', 'VEC4'],
        ['scale', 'VEC3'],
      ]) {
        const sampler = replacement.samplers.length;
        replacement.samplers.push({
          input,
          output: accessor(tracks.get(b.name)[property], type),
          interpolation: 'LINEAR',
        });
        replacement.channels.push({
          sampler,
          target: {
            node: doc.nodes.findIndex(
              (n) => T.PropertyBinding.sanitizeNodeName(n.name || '') === b.name,
            ),
            path: property,
          },
        });
      }
    doc.animations[doc.animations.findIndex((c) => c.name === source.name)] = replacement;
    Object.assign(
      asset.clips.find((c) => c.name === source.name),
      {
        seconds: source.duration,
        fps: 120,
        frames: count + 1,
        loop: true,
        description: `CMU ${source.trial} human ${source.name === 'Walk_Loop' ? 'walking' : 'running'} retargeted to the existing skeleton with stable anatomical joint planes and sole contact.`,
      },
    );
    const stride = source.distance * legScale;
    asset.locomotion[source.name] = {
      metresPerSecond: stride / source.duration,
      strideMetres: stride,
      cycleSeconds: source.duration,
      dutyFactor: source.duty,
      method: 'CMU measured human locomotion, anatomical retarget and sole contact',
    };
    changes.push({
      clip: source.name,
      trial: source.trial,
      startFrame: source.start + 1,
      endFrame: source.end + 1,
      phaseOffsetFrames: source.offset || 0,
      sampleRate: 120,
      frames: count + 1,
      seconds: source.duration,
      legScale,
      strideMetres: stride,
    });
  }
  doc.buffers[0].byteLength = byteLength;
  const bytes = pack(doc, Buffer.concat(chunks)),
    dir = `${out}/${key}`;
  await mkdir(dir, { recursive: true });
  try {
    await writeFile(`${dir}/model.glb`, bytes, { flag: 'wx' });
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    assert.equal(hash(await readFile(`${dir}/model.glb`)), hash(bytes), 'Use a new revision');
  }
  asset.humanLocomotion = {
    revision,
    sourceDelivery: asset.url,
    sourceSha256: asset.sha256,
    status: 'candidate-unreviewed',
    changes,
    reference: 'assets/human-locomotion/README.md',
  };
  asset.sha256 = hash(bytes);
  asset.bytes = bytes.length;
  await write(`${dir}/asset.json`, asset);
  console.log(key, revision, asset.sha256);
}
