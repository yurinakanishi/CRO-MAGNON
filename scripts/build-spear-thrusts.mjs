// Author only Attack on the delivered human skins. No mesh, rest rig or other clip edits.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as T from 'three';
import { loadMotion, pack, pose } from './motion-glb.mjs';
import { CHARACTER_MODELS } from '../dist/shared/characters.mjs';

const base = 'output/spear-thrusts',
  revision = process.argv[2] || 'revision-02';
const v = (x = 0, y = 0, z = 0) => new T.Vector3(x, y, z),
  q = () => new T.Quaternion();
const hash = (b) => createHash('sha256').update(b).digest('hex');
const smooth = (x) => {
  x = Math.max(0, Math.min(1, x));
  return x * x * x * (x * (x * 6 - 15) + 10);
};
const ramp = (t, a, b) => smooth((t - a) / (b - a));
function worldRotate(b, rotation) {
  b.quaternion.copy(b.parent.getWorldQuaternion(q()).invert().multiply(rotation));
  b.updateMatrixWorld(true);
}
function aim(b, child, target) {
  const p = b.getWorldPosition(v());
  worldRotate(
    b,
    q()
      .setFromUnitVectors(
        child.getWorldPosition(v()).sub(p).normalize(),
        target.clone().sub(p).normalize(),
      )
      .multiply(b.getWorldQuaternion(q())),
  );
}
function solve(limb, target, pole, orientation) {
  const start = limb.upper.getWorldPosition(v()),
    line = target.clone().sub(start),
    d = line.length();
  assert.ok(
    d < (limb.a + limb.b) * 0.9998,
    `${limb.upper.name} unreachable ${d.toFixed(5)} / ${(limb.a + limb.b).toFixed(5)}`,
  );
  line.normalize();
  pole = pole.clone().addScaledVector(line, -pole.dot(line)).normalize();
  const along = (limb.a ** 2 - limb.b ** 2 + d * d) / (2 * d);
  const middle = start
    .clone()
    .addScaledVector(line, along)
    .addScaledVector(pole, Math.sqrt(Math.max(0, limb.a ** 2 - along ** 2)));
  aim(limb.upper, limb.lower, middle);
  aim(limb.lower, limb.end, target);
  worldRotate(limb.end, orientation);
}

for (const { key } of CHARACTER_MODELS.filter((m) => ['cro', 'nea'].includes(m.species))) {
  const sourceDir = `${base}/baseline/${key}`;
  await mkdir(sourceDir, { recursive: true });
  const delivered = JSON.parse(await readFile(`public/models/${key}/asset.json`, 'utf8'));
  for (const [from, to] of [
    ['public' + delivered.url, 'model.glb'],
    [`public/models/${key}/asset.json`, 'asset.json'],
  ]) {
    try {
      await copyFile(from, `${sourceDir}/${to}`, 1);
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
  }
  const g = await loadMotion(`${sourceDir}/model.glb`),
    { doc, binary } = g;
  const asset = JSON.parse(await readFile(`${sourceDir}/asset.json`, 'utf8')),
    h = asset.heightMetres;
  assert.equal(hash(g.bytes), asset.sha256);
  const bone = (name) => g.scene.getObjectByName(name),
    bones = [];
  g.scene.traverse((n) => {
    if (n.isBone) bones.push(n);
  });
  const limb = (a, b, c) => {
    const upper = bone(a),
      lower = bone(b),
      end = bone(c);
    return {
      upper,
      lower,
      end,
      a: upper.getWorldPosition(v()).distanceTo(lower.getWorldPosition(v())),
      b: lower.getWorldPosition(v()).distanceTo(end.getWorldPosition(v())),
      anchor: end.getWorldPosition(v()),
      orientation: end.getWorldQuaternion(q()),
    };
  };
  const legs = ['L', 'R'].map((s) => limb('UpperLeg' + s, 'LowerLeg' + s, 'Foot' + s));
  const arms = ['L', 'R'].map((s) => {
    const l = limb('UpperArm' + s, 'LowerArm' + s, 'Hand' + s),
      grip = bone('Grip' + s);
    // Use the same rest attachment as CharacterAssets.handGripPlacement().
    const gripUp = q().setFromUnitVectors(
      v(0, 1, 0),
      v(0, 1, 0).applyQuaternion(grip.getWorldQuaternion(q()).invert()),
    );
    return { ...l, grip, gripUp, offset: grip.position.clone(), relative: grip.quaternion.clone() };
  });
  for (const [li, leg] of legs.entries()) {
    const points = [];
    g.scene.traverse((mesh) => {
      if (!mesh.isSkinnedMesh) return;
      const a = mesh.geometry.attributes;
      for (let i = 0; i < a.position.count; i++) {
        let w = 0;
        for (let c = 0; c < 4; c++)
          if (
            [leg.upper.name, leg.lower.name, leg.end.name, 'Toe' + ['L', 'R'][li]].includes(
              mesh.skeleton.bones[a.skinIndex.array[i * 4 + c]].name,
            )
          )
            w += a.skinWeight.array[i * 4 + c];
        if (w > 0.75) {
          const p = mesh.getVertexPosition(i, v()).applyMatrix4(mesh.matrixWorld);
          if (p.y < h * 0.09) points.push({ mesh, i, p });
        }
      }
    });
    leg.minimum = Math.min(...points.map((p) => p.p.y));
    const sole = points.filter((p) => p.p.y < leg.minimum + h * 0.012);
    leg.sole = sole.filter((_, i) => i % Math.max(1, Math.floor(sole.length / 180)) === 0);
    leg.centre = leg.sole.reduce((s, p) => s.add(p.p), v()).multiplyScalar(1 / leg.sole.length);
  }
  const idleMixer = pose(
    g,
    g.animations.find((c) => c.name === 'Idle_Loop'),
    0,
  );
  const idle = new Map(
    bones.map((b) => [
      b.name,
      { p: b.position.clone(), q: b.quaternion.clone(), s: b.scale.clone() },
    ]),
  );
  const idleArms = arms.map((a) => ({
    grip: a.grip.getWorldPosition(v()),
    rotation: a.end.getWorldQuaternion(q()),
    pole: a.lower.getWorldPosition(v()).sub(a.upper.getWorldPosition(v())).normalize(),
  }));
  idleMixer.stopAllAction();
  const restore = () => {
    for (const b of bones) {
      const r = idle.get(b.name);
      b.position.copy(r.p);
      b.quaternion.copy(r.q);
      b.scale.copy(r.s);
    }
    g.scene.updateMatrixWorld(true);
  };
  const tracks = new Map(bones.map((b) => [b.name, { translation: [], rotation: [], scale: [] }])),
    times = [];
  // Include authoritative 333 ms impact exactly, in addition to 120 Hz keys.
  const samples = [...new Set([...Array.from({ length: 85 }, (_, i) => i / 120), 0.333])].sort(
    (a, b) => a - b,
  );
  for (const t of samples) {
    restore();
    const engage = ramp(t, 0, 0.14) * (1 - ramp(t, 0.52, 0.7));
    const drive = ramp(t, 0.16, 0.333) * (1 - ramp(t, 0.39, 0.53));
    const step = ramp(t, 0.14, 0.333) * (1 - ramp(t, 0.45, 0.7));
    const leftLift =
      0.04 * h * Math.sin(Math.PI * ramp(t, 0.14, 0.333)) ** 2 +
      0.035 * h * Math.sin(Math.PI * ramp(t, 0.45, 0.7)) ** 2;
    const yaw = (-0.52 + 0.3 * drive) * engage;
    const hips = bone('Hips');
    const displacement = v(
      0,
      -h * (0.02 * engage + 0.042 * step),
      h * (-0.008 * engage + 0.18 * drive),
    );
    hips.position.add(displacement.applyQuaternion(hips.parent.getWorldQuaternion(q()).invert()));
    worldRotate(
      hips,
      q()
        .setFromAxisAngle(v(0, 1, 0), yaw * 0.55)
        .multiply(hips.getWorldQuaternion(q())),
    );
    const spine = bone('Spine');
    worldRotate(
      spine,
      q()
        .setFromAxisAngle(v(1, 0, 0), 0.22 * drive)
        .multiply(spine.getWorldQuaternion(q())),
    );
    const chest = bone('Chest');
    worldRotate(
      chest,
      q()
        .setFromEuler(new T.Euler(0.05 * drive, yaw * 0.45, 0))
        .multiply(chest.getWorldQuaternion(q())),
    );
    const neck = bone('Neck');
    worldRotate(
      neck,
      q()
        .setFromAxisAngle(v(0, 1, 0), -yaw * 0.75)
        .multiply(neck.getWorldQuaternion(q())),
    );
    const targets = legs.map((l, i) =>
      l.anchor
        .clone()
        .add(v(0, i === 0 ? leftLift : 0, h * (i === 0 ? 0.28 * step : -0.018 * engage))),
    );
    // Keep the support knee slightly bent, even for the source rigs with straight rest legs.
    let extraDrop = 0;
    for (const [i, l] of legs.entries()) {
      const top = l.upper.getWorldPosition(v()),
        p = targets[i],
        reach = (l.a + l.b) * 0.992;
      const horizontal = (top.x - p.x) ** 2 + (top.z - p.z) ** 2;
      extraDrop = Math.max(extraDrop, top.y - p.y - Math.sqrt(reach * reach - horizontal));
    }
    hips.position.add(
      v(0, -extraDrop - 0.003, 0).applyQuaternion(hips.parent.getWorldQuaternion(q()).invert()),
    );
    g.scene.updateMatrixWorld(true);
    for (let i = 0; i < 2; i++) solve(legs[i], targets[i], v(0, 0, 1), legs[i].orientation);
    for (let iteration = 0; iteration < 5; iteration++) {
      g.scene.traverse((n) => {
        if (n.isSkinnedMesh) n.skeleton.update();
      });
      for (const [i, l] of legs.entries()) {
        const centre = v();
        let low = Infinity;
        for (const s of l.sole) {
          const p = s.mesh.getVertexPosition(s.i, v()).applyMatrix4(s.mesh.matrixWorld);
          centre.add(p);
          low = Math.min(low, p.y);
        }
        centre.multiplyScalar(1 / l.sole.length);
        const ideal = l.centre
          .clone()
          .add(v(0, i === 0 ? leftLift : 0, h * (i === 0 ? 0.28 * step : -0.018 * engage)));
        targets[i].addScaledVector(
          v(
            ideal.x - centre.x,
            l.minimum + 0.003 + (i === 0 ? leftLift : 0) - low,
            ideal.z - centre.z,
          ),
          0.9,
        );
        solve(l, targets[i], v(0, 0, 1), l.orientation);
      }
    }
    const rear = v(
      h * (-0.15 + 0.015 * drive),
      h * (0.635 + 0.01 * drive),
      h * (-0.045 + 0.205 * drive),
    );
    const shaft = v(0, 0.08 * (1 - drive), 1).normalize();
    const weaponQ = q().setFromUnitVectors(v(0, 1, 0), shaft);
    const poses = [];
    for (const [i, a] of arms.entries()) {
      const target = rear.clone().addScaledVector(shaft, i === 0 ? h * 0.2 : 0);
      const orientation = weaponQ
        .clone()
        .multiply(a.gripUp.clone().invert())
        .multiply(a.relative.clone().invert());
      orientation.copy(idleArms[i].rotation.clone().slerp(orientation, engage));
      target.copy(idleArms[i].grip.clone().lerp(target, engage));
      const wrist = target.add(a.offset.clone().applyQuaternion(orientation).negate());
      const pole = idleArms[i].pole
        .clone()
        .lerp(v(i === 0 ? 1 : -1, -0.8, -0.35).normalize(), engage);
      poses.push({ a, wrist, pole, orientation });
    }
    // Project the shared shaft position into both arms' reachable workspace.
    // Moving both wrists together preserves the two grips' spacing and alignment.
    for (let iteration = 0; iteration < 12; iteration++)
      for (const p of poses) {
        const delta = p.wrist.clone().sub(p.a.upper.getWorldPosition(v())),
          length = delta.length(),
          limit = (p.a.a + p.a.b) * 0.985;
        if (length > limit)
          for (const other of poses) other.wrist.addScaledVector(delta, (limit - length) / length);
      }
    for (const p of poses) solve(p.a, p.wrist, p.pole, p.orientation);
    g.scene.updateMatrixWorld(true);
    times.push(t);
    for (const b of bones) {
      const tr = tracks.get(b.name);
      tr.translation.push(...b.position.toArray());
      tr.rotation.push(...b.quaternion.toArray());
      tr.scale.push(...b.scale.toArray());
    }
  }
  const chunks = [binary];
  let length = binary.length;
  function accessor(values, type) {
    const bytes = Buffer.from(new Float32Array(values).buffer),
      view = doc.bufferViews.length;
    doc.bufferViews.push({ buffer: 0, byteOffset: length, byteLength: bytes.length });
    chunks.push(bytes);
    length += bytes.length;
    const a = {
      bufferView: view,
      componentType: 5126,
      count: values.length / { SCALAR: 1, VEC3: 3, VEC4: 4 }[type],
      type,
    };
    if (type === 'SCALAR') {
      a.min = [values[0]];
      a.max = [values.at(-1)];
    }
    doc.accessors.push(a);
    return doc.accessors.length - 1;
  }
  const input = accessor(times, 'SCALAR'),
    clip = { name: 'Attack', samplers: [], channels: [] };
  for (const b of bones)
    for (const [prop, type] of [
      ['translation', 'VEC3'],
      ['rotation', 'VEC4'],
      ['scale', 'VEC3'],
    ]) {
      const node = doc.nodes.findIndex(
        (n) => T.PropertyBinding.sanitizeNodeName(n.name || '') === b.name,
      );
      assert.ok(node >= 0);
      clip.channels.push({ sampler: clip.samplers.length, target: { node, path: prop } });
      clip.samplers.push({
        input,
        output: accessor(tracks.get(b.name)[prop], type),
        interpolation: 'LINEAR',
      });
    }
  doc.animations[doc.animations.findIndex((c) => c.name === 'Attack')] = clip;
  doc.buffers[0].byteLength = length;
  const bytes = pack(doc, Buffer.concat(chunks)),
    dir = `${base}/${revision}/${key}`;
  await mkdir(dir, { recursive: true });
  try {
    await writeFile(`${dir}/model.glb`, bytes, { flag: 'wx' });
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    assert.equal(hash(await readFile(`${dir}/model.glb`)), hash(bytes), 'Use a new revision');
  }
  asset.spearThrust = {
    revision,
    status: 'candidate-unreviewed',
    sourceSha256: asset.sha256,
    sourceDelivery: asset.url,
    clip: 'Attack',
    seconds: 0.7,
    impactSeconds: 0.333,
    frames: samples.length,
    sampleRate: 120,
    leftStepMetres: h * 0.28,
    handSpacingMetres: h * 0.2,
    attachment: 'authored-grip',
    author: 'Codex',
  };
  asset.sha256 = hash(bytes);
  asset.bytes = bytes.length;
  asset.clips.find((c) => c.name === 'Attack').seconds = 0.7;
  await writeFile(`${dir}/asset.json`, JSON.stringify(asset, null, 2) + '\n');
  console.log(key, asset.sha256);
}
