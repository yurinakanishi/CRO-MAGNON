// Run-only repair. Keep the delivered walk, spear attack, skin and original bytes.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as T from 'three';
import { CHARACTER_MODELS } from '../dist/shared/characters.mjs';
import { loadMotion, pack } from './motion-glb.mjs';

const revision = process.argv[2] || 'revision-05';
const only = process.argv[3];
const v = () => new T.Vector3();
const q = () => new T.Quaternion();
const rad = T.MathUtils.degToRad;
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = async (file) => JSON.parse(await readFile(file, 'utf8'));
const smooth = (x) => x * x * (3 - 2 * x);
// Shape-preserving interior tangents; optional boundary slopes join the stance.
// The exported-GLB check also bounds extrema across those boundary segments.
function curve(keys, x, boundary = [0, 0]) {
  const i = Math.max(
    0,
    keys.findIndex((k, i) => i < keys.length - 1 && x <= keys[i + 1][0]),
  );
  const [a, b] = [keys[i], keys[i + 1]];
  function tangent(j) {
    if (j === 0) return boundary[0];
    if (j === keys.length - 1) return boundary[1];
    const h0 = keys[j][0] - keys[j - 1][0],
      h1 = keys[j + 1][0] - keys[j][0];
    const d0 = (keys[j][1] - keys[j - 1][1]) / h0,
      d1 = (keys[j + 1][1] - keys[j][1]) / h1;
    if (d0 * d1 <= 0) return 0;
    return (3 * (h0 + h1)) / ((2 * h1 + h0) / d0 + (h1 + 2 * h0) / d1);
  }
  const u = T.MathUtils.clamp((x - a[0]) / (b[0] - a[0]), 0, 1),
    h = b[0] - a[0];
  return (
    a[1] * (1 - smooth(u)) +
    b[1] * smooth(u) +
    h * (tangent(i) * (u ** 3 - 2 * u ** 2 + u) + tangent(i + 1) * (u ** 3 - u ** 2))
  );
}
function worldRotate(bone, desired) {
  bone.quaternion.copy(bone.parent.getWorldQuaternion(q()).invert().multiply(desired));
  bone.updateMatrixWorld(true);
}
function frame(direction) {
  const y = direction.clone().normalize();
  const x = new T.Vector3(1, 0, 0).addScaledVector(y, -y.x).normalize();
  return q().setFromRotationMatrix(new T.Matrix4().makeBasis(x, y, x.clone().cross(y)));
}

for (const { key } of CHARACTER_MODELS) {
  if (only && key !== only) continue;
  const sourceManifest = `assets/player-gaits/run-source-manifests/${key}.json`;
  await mkdir('assets/player-gaits/run-source-manifests', { recursive: true });
  try {
    await copyFile(`public/models/${key}/asset.json`, sourceManifest, 1);
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
  }
  const asset = await json(sourceManifest);
  const g = await loadMotion('public' + asset.url);
  assert.equal(hash(g.bytes), asset.sha256);
  const { doc, binary } = g;
  const bones = [];
  g.scene.traverse((n) => {
    if (n.isBone) bones.push(n);
  });
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
  const bone = (name) => g.scene.getObjectByName(name);
  const hips = bone('Hips');
  function restore() {
    for (const b of bones) {
      const r = rest.get(b.name);
      b.position.copy(r.p);
      b.quaternion.copy(r.q);
      b.scale.copy(r.s);
    }
    g.scene.updateMatrixWorld(true);
  }
  // A fixed world sagittal frame removes the free axial twist of shortest-arc IK.
  function direct(b, child, direction) {
    const r = rest.get(b.name);
    const from = rest.get(child.name).wp.clone().sub(r.wp);
    worldRotate(b, frame(direction).multiply(frame(from).invert()).multiply(r.wq));
  }
  const legs = ['L', 'R'].map((side, i) => {
    const upper = bone('UpperLeg' + side),
      lower = bone('LowerLeg' + side),
      foot = bone('Foot' + side);
    const a = upper.getWorldPosition(v()).distanceTo(lower.getWorldPosition(v()));
    const b = lower.getWorldPosition(v()).distanceTo(foot.getWorldPosition(v()));
    return { side, phase: i * 0.5, upper, lower, foot, a, b, sole: [] };
  });
  g.scene.traverse((mesh) => {
    if (!mesh.isSkinnedMesh) return;
    const a = mesh.geometry.attributes;
    for (let i = 0; i < a.position.count; i++) {
      const p = mesh.getVertexPosition(i, v()).applyMatrix4(mesh.matrixWorld);
      if (p.y > asset.heightMetres * 0.075) continue;
      for (const leg of legs) {
        let weight = 0;
        for (let c = 0; c < 4; c++)
          if (
            ['Foot' + leg.side, 'Toe' + leg.side].includes(
              mesh.skeleton.bones[a.skinIndex.array[i * 4 + c]].name,
            )
          )
            weight += a.skinWeight.array[i * 4 + c];
        if (weight > 0.7) leg.sole.push({ mesh, i, p });
      }
    }
  });
  for (const leg of legs) {
    const lowest = Math.min(...leg.sole.map((s) => s.p.y));
    leg.sole = leg.sole
      .filter((s) => s.p.y < lowest + asset.heightMetres * 0.016)
      .filter((s, i) => i % 3 === 0);
    assert.ok(leg.sole.length > 8, key + ' sole');
    leg.centre = leg.sole.reduce((p, s) => p.add(s.p), v()).multiplyScalar(1 / leg.sole.length);
    leg.offsets = leg.sole.map((s) => s.p.clone().sub(rest.get(leg.foot.name).wp));
  }
  const length = Math.min(...legs.map((l) => l.a + l.b));
  const ape = key === 'giant-ape',
    small = key === 'desert-fennec-mage';
  const duration = small ? 0.76 : ape ? 0.9 : 0.84;
  const duty = 0.36,
    stride = length * 1.95;
  const stancePitch = (p) =>
    curve(
      [
        [0, -0.06],
        [0.07, 0],
        [0.19, 0],
        [duty, 0.58],
      ],
      p,
    );
  const stanceKnee = (p) =>
    rad(
      curve(
        [
          [0, 22],
          [0.13, 44],
          [0.23, 36],
          [duty, 22],
        ],
        p,
      ),
    );
  function stance(leg, p) {
    const pitch = stancePitch(p),
      rotation = q().setFromAxisAngle(new T.Vector3(1, 0, 0), pitch);
    const offsets = leg.offsets.map((d) => d.clone().applyQuaternion(rotation));
    const centre = offsets.reduce((p, d) => p.add(d), v()).multiplyScalar(1 / offsets.length);
    const top = rest.get(leg.upper.name).wp;
    const target = new T.Vector3(
      T.MathUtils.lerp(top.x, leg.centre.x, ape ? 0.8 : 0.35),
      0.003 - Math.min(...offsets.map((d) => d.y)),
      leg.centre.z + length * 0.22 - stride * p - centre.z,
    );
    const bend = stanceKnee(p);
    const reach2 = leg.a ** 2 + leg.b ** 2 + 2 * leg.a * leg.b * Math.cos(bend);
    const vertical = Math.sqrt(reach2 - (target.x - top.x) ** 2 - (target.z - top.z) ** 2);
    assert.ok(Number.isFinite(vertical));
    return { target, pitch, pelvisY: target.y + vertical - (top.y - rest.get('Hips').wp.y) };
  }
  const contactY = Math.min(...legs.map((l) => stance(l, 0).pelvisY));
  const lowY = Math.min(...legs.map((l) => stance(l, 0.13).pelvisY));
  const launchY = Math.min(...legs.map((l) => stance(l, duty).pelvisY)) - length * 0.006;
  const apexY = launchY + length * 0.024;
  const landingSlope = 2 / (1 / ((contactY - apexY) / 0.1) + 1 / ((lowY - contactY) / 0.13));
  function pelvisY(phase) {
    const p = phase % 0.5;
    const smallFlight =
      small && p > duty
        ? asset.heightMetres * 0.025 * Math.sin((Math.PI * (p - duty)) / (0.5 - duty)) ** 2
        : 0;
    return (
      curve(
        [
          [0, contactY],
          [0.13, lowY],
          [0.34, launchY],
          [0.4, apexY],
          [0.5, contactY],
        ],
        p,
        [landingSlope, landingSlope],
      ) -
      (ape ? length * 0.04 : 0) +
      smallFlight
    );
  }
  function solve(leg, target) {
    const top = leg.upper.getWorldPosition(v()),
      line = target.clone().sub(top);
    const distance = line.length();
    assert.ok(
      distance < (leg.a + leg.b) * 0.9998 && distance > Math.abs(leg.a - leg.b),
      `${key} ${leg.side} reachable: ${distance} / ${leg.a + leg.b}`,
    );
    const direction = line.normalize();
    const pole = new T.Vector3(0, 0, 1).addScaledVector(direction, -direction.z).normalize();
    const along = (leg.a ** 2 - leg.b ** 2 + distance ** 2) / (2 * distance);
    const knee = top
      .clone()
      .addScaledVector(direction, along)
      .addScaledVector(pole, Math.sqrt(Math.max(0, leg.a ** 2 - along ** 2)));
    direct(leg.upper, leg.lower, knee.clone().sub(top));
    direct(leg.lower, leg.foot, target.clone().sub(knee));
  }
  function angles(leg, p) {
    restore();
    const s = stance(leg, p);
    hips.position.add(
      new T.Vector3(0, pelvisY(p) - rest.get('Hips').wp.y, 0).applyQuaternion(
        hips.parent.getWorldQuaternion(q()).invert(),
      ),
    );
    hips.updateMatrixWorld(true);
    solve(leg, s.target);
    const a = leg.upper.getWorldPosition(v()),
      b = leg.lower.getWorldPosition(v()),
      c = leg.foot.getWorldPosition(v());
    return { hip: Math.atan2(b.z - a.z, a.y - b.y), knee: Math.PI - a.sub(b).angleTo(c.sub(b)) };
  }
  for (const leg of legs) {
    leg.liftOff = angles(leg, duty);
    leg.contact = angles(leg, 0);
    const before = angles(leg, duty - 0.0001),
      after = angles(leg, 0.0001);
    leg.hipSlopes = [
      (leg.liftOff.hip - before.hip) / 0.0001,
      (after.hip - leg.contact.hip) / 0.0001,
    ];
    leg.kneeSlopes = [
      (leg.liftOff.knee - before.knee) / 0.0001,
      (after.knee - leg.contact.knee) / 0.0001,
    ];
  }
  const frames = Math.round(duration * 120);
  const tracks = new Map(bones.map((b) => [b.name, { translation: [], rotation: [], scale: [] }]));
  const times = [];
  for (let f = 0; f <= frames; f++) {
    const phase = f === frames ? 0 : f / frames;
    restore();
    hips.position.add(
      new T.Vector3(0, pelvisY(phase) - rest.get('Hips').wp.y, 0).applyQuaternion(
        hips.parent.getWorldQuaternion(q()).invert(),
      ),
    );
    hips.updateMatrixWorld(true);
    // Modest forward trunk inclination; oppose the actual thigh drive with each arm.
    direct(bone('Spine'), bone('Chest'), new T.Vector3(0, 1, 0.12));
    direct(bone('Chest'), bone('Neck'), new T.Vector3(0, 1, 0.1));
    for (const leg of legs) {
      const p = (phase + leg.phase) % 1;
      let pitch;
      if (p <= duty) {
        const s = stance(leg, p);
        solve(leg, s.target);
        pitch = s.pitch;
      } else {
        const hip = curve(
          [
            [duty, leg.liftOff.hip],
            [0.43, rad(-18)],
            [0.57, rad(10)],
            [0.72, rad(40)],
            [0.8, rad(43)],
            [1, leg.contact.hip],
          ],
          p,
          leg.hipSlopes,
        );
        const knee = curve(
          [
            [duty, leg.liftOff.knee],
            [0.48, rad(78)],
            [0.58, rad(104)],
            [0.68, rad(100)],
            [0.82, rad(56)],
            [0.96, rad(20)],
            [1, leg.contact.knee],
          ],
          p,
          leg.kneeSlopes,
        );
        const lateral = (stance(leg, 0).target.x - rest.get(leg.upper.name).wp.x) / (leg.a + leg.b);
        direct(leg.upper, leg.lower, new T.Vector3(lateral, -Math.cos(hip), Math.sin(hip)));
        direct(
          leg.lower,
          leg.foot,
          new T.Vector3(lateral, -Math.cos(hip - knee), Math.sin(hip - knee)),
        );
        pitch = curve(
          [
            [duty, stancePitch(duty)],
            [0.48, 0.75],
            [0.64, 0.35],
            [0.83, -0.1],
            [1, stancePitch(0)],
          ],
          p,
        );
      }
      worldRotate(
        leg.foot,
        q()
          .setFromAxisAngle(new T.Vector3(1, 0, 0), pitch)
          .multiply(rest.get(leg.foot.name).wq),
      );
      const top = leg.upper.getWorldPosition(v()),
        knee = leg.lower.getWorldPosition(v());
      const hip = Math.atan2(knee.z - top.z, top.y - knee.y);
      const upper = 0.1 - hip * 0.85,
        elbow = ape ? 1.05 : 1.4;
      const sign = leg.side === 'L' ? 1 : -1;
      direct(
        bone('UpperArm' + leg.side),
        bone('LowerArm' + leg.side),
        new T.Vector3(sign * (ape ? 0.28 : 0.14), -Math.cos(upper), Math.sin(upper)),
      );
      direct(
        bone('LowerArm' + leg.side),
        bone('Hand' + leg.side),
        new T.Vector3(-sign * 0.02, -Math.cos(upper + elbow), Math.sin(upper + elbow)),
      );
    }
    // Correct the small difference between rigid-sole placement and the weighted skin.
    // This never drives the pelvis or the large swing trajectory.
    for (let iteration = 0; iteration < 4; iteration++) {
      g.scene.updateMatrixWorld(true);
      g.scene.traverse((n) => {
        if (n.isSkinnedMesh) n.skeleton.update();
      });
      for (const leg of legs) {
        const p = (phase + leg.phase) % 1;
        const y = Math.min(
          ...leg.sole.map(
            (s) => s.mesh.getVertexPosition(s.i, v()).applyMatrix4(s.mesh.matrixWorld).y,
          ),
        );
        const correction = p <= duty ? 0.003 - y : Math.max(0, 0.003 - y);
        if (Math.abs(correction) < 0.00001) continue;
        const orientation = leg.foot.getWorldQuaternion(q());
        solve(leg, leg.foot.getWorldPosition(v()).add(new T.Vector3(0, correction * 0.95, 0)));
        worldRotate(leg.foot, orientation);
      }
    }
    times.push((duration * f) / frames);
    for (const b of bones) {
      const t = tracks.get(b.name);
      t.translation.push(...b.position.toArray());
      const rotation = b.quaternion.clone();
      if (t.rotation.length && rotation.dot(new T.Quaternion(...t.rotation.slice(-4))) < 0)
        rotation.set(-rotation.x, -rotation.y, -rotation.z, -rotation.w);
      t.rotation.push(...rotation.toArray());
      t.scale.push(...b.scale.toArray());
    }
  }
  const chunks = [binary];
  let byteLength = binary.length;
  function accessor(values, type) {
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
  const input = accessor(times, 'SCALAR'),
    replacement = { name: 'Run_Loop', samplers: [], channels: [] };
  for (const b of bones) {
    const node = doc.nodes.findIndex(
      (n) => T.PropertyBinding.sanitizeNodeName(n.name || '') === b.name,
    );
    assert.ok(node >= 0);
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
      replacement.channels.push({ sampler, target: { node, path: property } });
    }
  }
  doc.animations[doc.animations.findIndex((c) => c.name === 'Run_Loop')] = replacement;
  doc.buffers[0].byteLength = byteLength;
  const bytes = pack(doc, Buffer.concat(chunks)),
    dir = `output/player-gaits/${revision}/${key}`;
  await mkdir(dir, { recursive: true });
  try {
    await writeFile(dir + '/model.glb', bytes, { flag: 'wx' });
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    assert.equal(hash(await readFile(dir + '/model.glb')), hash(bytes), 'use a new revision');
  }
  asset.playerRun = {
    revision,
    sourceSha256: asset.sha256,
    sourceDelivery: asset.url,
    status: 'candidate-unreviewed',
    method:
      'Bounded sagittal joint recovery, grounded flexion/extension stance, independent flight pelvis, stable bone twist',
    stanceFraction: duty,
    peakAuthoredSwingKneeDegrees: 104,
  };
  asset.sha256 = hash(bytes);
  asset.bytes = bytes.length;
  asset.clips.find((c) => c.name === 'Run_Loop').seconds = duration;
  asset.locomotion.Run_Loop = {
    ...asset.locomotion.Run_Loop,
    metresPerSecond: stride / duration,
    cycleSeconds: duration,
    strideMetres: stride,
    dutyFactor: duty,
    method: asset.playerRun.method,
  };
  delete asset.locomotion.Run_Loop.swingLiftMetres;
  await writeFile(dir + '/asset.json', JSON.stringify(asset, null, 2) + '\n');
  console.log(key, revision, asset.sha256);
}
