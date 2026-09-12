import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { loadMotion, pack } from './motion-glb.mjs';

import { CHARACTER_MODELS } from '../dist/shared/characters.mjs';
const base = 'output/player-gaits',
  revision = process.argv[2] || 'revision-02';
const v = () => new THREE.Vector3();
const q = () => new THREE.Quaternion();
const smooth = (x) => x * x * x * (x * (x * 6 - 15) + 10);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

function worldRotate(bone, desired) {
  bone.quaternion.copy(bone.parent.getWorldQuaternion(q()).invert().multiply(desired));
  bone.updateMatrixWorld(true);
}
function aimChild(bone, child, point) {
  const start = bone.getWorldPosition(v()),
    from = child.getWorldPosition(v()).sub(start).normalize(),
    to = point.clone().sub(start).normalize();
  worldRotate(bone, q().setFromUnitVectors(from, to).multiply(bone.getWorldQuaternion(q())));
}
function solveLeg(leg, target, pitch = 0) {
  const start = leg.upper.getWorldPosition(v()),
    line = target.clone().sub(start),
    distance = line.length();
  if (distance > (leg.a + leg.b) * 0.9995)
    throw Error(`Unreachable ${leg.foot.name}: ${distance} > ${leg.a + leg.b}`);
  const direction = line.normalize(),
    pole = new THREE.Vector3(0, 0, leg.bend);
  pole.addScaledVector(direction, -pole.dot(direction)).normalize();
  const along = (leg.a * leg.a - leg.b * leg.b + distance * distance) / (2 * distance);
  const knee = start
    .clone()
    .addScaledVector(direction, along)
    .addScaledVector(pole, Math.sqrt(Math.max(0, leg.a * leg.a - along * along)));
  aimChild(leg.upper, leg.lower, knee);
  aimChild(leg.lower, leg.foot, target);
  worldRotate(
    leg.foot,
    q()
      .setFromAxisAngle(new THREE.Vector3(1, 0, 0), pitch)
      .multiply(leg.orientation),
  );
}

for (const { key } of CHARACTER_MODELS) {
  const delivered = JSON.parse(await readFile('public/models/' + key + '/asset.json'));
  const current = delivered.playerGaits
    ? JSON.parse(await readFile('assets/player-gaits/source-manifests/' + key + '.json'))
    : delivered;
  const source = `public/models/${key}`;
  await mkdir(`${base}/baseline/${key}`, { recursive: true });
  for (const name of ['model.glb', 'asset.json']) {
    try {
      await copyFile(
        name === 'model.glb'
          ? 'public' + current.url
          : delivered.playerGaits
            ? 'assets/player-gaits/source-manifests/' + key + '.json'
            : source + '/asset.json',
        `${base}/baseline/${key}/${name}`,
        1,
      );
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
  }
  const gltf = await loadMotion(`${base}/baseline/${key}/model.glb`),
    { doc, binary } = gltf;
  const manifest = JSON.parse(await readFile(`${base}/baseline/${key}/asset.json`, 'utf8'));
  assert.equal(hash(gltf.bytes), manifest.sha256, key + ' baseline hash');
  const bones = [];
  gltf.scene.traverse((n) => {
    if (n.isBone) bones.push(n);
  });
  const rest = new Map(
    bones.map((b) => [
      b.name,
      { p: b.position.clone(), q: b.quaternion.clone(), s: b.scale.clone() },
    ]),
  );
  const restore = () => {
    for (const b of bones) {
      const r = rest.get(b.name);
      b.position.copy(r.p);
      b.quaternion.copy(r.q);
      b.scale.copy(r.s);
    }
    gltf.scene.updateMatrixWorld(true);
  };
  const legs = ['L', 'R'].map((side, index) => {
    const upper = gltf.scene.getObjectByName('UpperLeg' + side),
      lower = gltf.scene.getObjectByName('LowerLeg' + side),
      foot = gltf.scene.getObjectByName('Foot' + side);
    return {
      upper,
      lower,
      foot,
      anchor: foot.getWorldPosition(v()),
      orientation: foot.getWorldQuaternion(q()),
      a: upper.getWorldPosition(v()).distanceTo(lower.getWorldPosition(v())),
      b: lower.getWorldPosition(v()).distanceTo(foot.getWorldPosition(v())),
      bend: 1,
      phase: index * 0.5,
    };
  });
  // Surface contact is evaluated from the source skin, not just the ankle bone.
  for (const leg of legs) {
    const candidates = [];
    gltf.scene.traverse((mesh) => {
      if (!mesh.isSkinnedMesh) return;
      const a = mesh.geometry.attributes;
      for (let i = 0; i < a.position.count; i++) {
        let influence = 0;
        for (let c = 0; c < 4; c++) {
          const name = mesh.skeleton.bones[a.skinIndex.array[i * 4 + c]].name;
          if (
            [
              leg.foot.name,
              leg.lower.name,
              leg.upper.name,
              leg.foot.name.replace('Foot', 'Toe'),
            ].includes(name)
          )
            influence += a.skinWeight.array[i * 4 + c];
        }
        if (influence > 0.75) {
          const p = mesh.getVertexPosition(i, v()).applyMatrix4(mesh.matrixWorld);
          if (p.y < manifest.heightMetres * 0.09) candidates.push({ mesh, i, p });
        }
      }
    });
    const lowest = Math.min(...candidates.map((s) => s.p.y)),
      sole = candidates.filter((s) => s.p.y < lowest + manifest.heightMetres * 0.012);
    leg.sole = sole.filter((_, i) => i % Math.max(1, Math.floor(sole.length / 160)) === 0);
    if (!leg.sole.length) throw Error('No sole samples ' + key + ' ' + leg.foot.name);
    leg.soleMinimum = lowest;
    leg.soleCentre = leg.sole.reduce((s, p) => s.add(p.p), v()).multiplyScalar(1 / leg.sole.length);
  }
  const chunks = [binary];
  let byteLength = binary.length;
  const changes = [];
  function accessor(values, type) {
    const data = Buffer.from(new Float32Array(values).buffer);
    const bv = doc.bufferViews.length;
    doc.bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: data.length });
    chunks.push(data);
    byteLength += data.length;
    const size = { SCALAR: 1, VEC3: 3, VEC4: 4 }[type],
      a = { bufferView: bv, componentType: 5126, count: values.length / size, type };
    if (type === 'SCALAR') {
      a.min = [Math.min(...values)];
      a.max = [Math.max(...values)];
    }
    doc.accessors.push(a);
    return doc.accessors.length - 1;
  }
  for (let ci = 0; ci < gltf.animations.length; ci++) {
    const clip = gltf.animations[ci],
      gait = ['Walk_Loop', 'Run_Loop'].includes(clip.name);
    if (!gait) continue;
    restore();
    const run = clip.name === 'Run_Loop',
      small = key === 'desert-fennec-mage',
      ape = key === 'giant-ape',
      duration = run ? (small ? 0.6 : ape ? 0.76 : 0.72) : small ? 0.9 : ape ? 1.2 : 1.1,
      frames = Math.round(duration * 60),
      height = manifest.heightMetres,
      length = Math.min(...legs.map((l) => l.a + l.b)),
      stride = length * (run ? 3.15 : 1.25),
      duty = run ? 0.36 : 0.6,
      lift = length * (run ? 0.48 : 0.06);
    const aim = (name, x, y, z) => {
      const bone = gltf.scene.getObjectByName(name),
        orientation = bone.getWorldQuaternion(q());
      const from = new THREE.Vector3(0, 1, 0).applyQuaternion(orientation).normalize();
      worldRotate(
        bone,
        q()
          .setFromUnitVectors(from, new THREE.Vector3(x, y, z).normalize())
          .multiply(orientation),
      );
    };
    const bodyAt = (phase) => {
      restore();
      const beat = phase * Math.PI * 2,
        hips = gltf.scene.getObjectByName('Hips'),
        pitch = run ? 0.16 : 0.015;
      worldRotate(
        hips,
        q()
          .setFromEuler(
            new THREE.Euler(
              pitch * 0.3,
              Math.sin(beat) * (run ? 0.09 : 0.055),
              Math.sin(beat) * (run ? 0.02 : 0.035),
            ),
          )
          .multiply(hips.getWorldQuaternion(q())),
      );
      aim('Spine', 0, 1, pitch);
      aim('Chest', Math.sin(beat) * 0.018, 1, pitch * 0.85);
      aim('Neck', 0, 1, 0.015);
      for (const [side, sign, offset] of [
        ['L', 1, 0],
        ['R', -1, 0.5],
      ]) {
        const upper =
          (run ? 0.1 : 0.025) - Math.cos((phase + offset) * Math.PI * 2) * (run ? 0.68 : 0.27);
        const elbow = run ? (ape ? 0.95 : 1.3) : ape ? 0.34 : 0.2;
        aim('UpperArm' + side, sign * (ape ? 0.26 : 0.15), -Math.cos(upper), Math.sin(upper));
        aim('LowerArm' + side, -sign * 0.04, -Math.cos(upper + elbow), Math.sin(upper + elbow));
      }
      gltf.scene.updateMatrixWorld(true);
    };
    const footPitch = (leg, phase) => {
      const p = (phase + leg.phase) % 1;
      return p < duty ? 0 : (run ? 0.9 : 0.2) * Math.sin((Math.PI * (p - duty)) / (1 - duty)) ** 2;
    };
    const tracks = new Map(
        bones.map((b) => [b.name, { rotation: [], translation: [], scale: [] }]),
      ),
      times = [];
    const targetAt = (leg, phase) => {
      const p = (phase + leg.phase) % 1,
        target = leg.anchor.clone();
      if (p < duty) target.z += stride * (duty * 0.5 - p);
      else {
        const u = (p - duty) / (1 - duty);
        target.z += -stride * duty * 0.5 - stride * (1 - duty) * u + stride * smooth(u);
        target.y += lift * Math.sin(Math.PI * u) ** 2;
      }
      return target;
    };
    let clearance = 0;
    const requiredDrops = [];
    for (let frame = 0; frame < frames; frame++) {
      bodyAt(frame / frames);
      let required = 0;
      for (const leg of legs) {
        const top = leg.upper.getWorldPosition(v()),
          target = targetAt(leg, frame / frames),
          reach = (leg.a + leg.b) * (run ? 0.94 : 0.99),
          horizontal = (top.x - target.x) ** 2 + (top.z - target.z) ** 2;
        if (horizontal >= reach * reach) throw Error(`${key} stride exceeds limb reach`);
        required = Math.max(required, top.y - target.y - Math.sqrt(reach * reach - horizontal));
      }
      requiredDrops.push(required);
      clearance = Math.max(clearance, required);
    }
    for (let frame = 0; frame <= frames; frame++) {
      const time = (frame / frames) * duration,
        phase = frame === frames ? 0 : frame / frames;
      bodyAt(phase);
      const hips = gltf.scene.getObjectByName('Hips');
      // Lower the authored pelvis only as required by limb reach; preserve bone lengths.
      const targets = legs.map((leg) => targetAt(leg, phase));
      // Smooth the necessary clearance while allowing the pelvis to rise over
      // the support foot. A constant maximum kept the subject crouched all cycle.
      const f = frame % frames;
      let drop = 0,
        weight = 0;
      for (let offset = -4; offset <= 4; offset++) {
        const w = 5 - Math.abs(offset);
        drop += requiredDrops[(f + offset + frames) % frames] * w;
        weight += w;
      }
      drop = Math.max(requiredDrops[f], drop / weight) + height * 0.001;
      const localDrop = new THREE.Vector3(0, -drop, 0).applyQuaternion(
        hips.parent.getWorldQuaternion(q()).invert(),
      );
      hips.position.add(localDrop);
      gltf.scene.updateMatrixWorld(true);
      for (let li = 0; li < legs.length; li++)
        solveLeg(legs[li], targets[li], footPitch(legs[li], phase));
      // The toes follow the planted foot as one continuous surface. Source toe
      // curls otherwise counter-rotate the flattened ankle at heel strike.
      for (const side of ['L', 'R']) {
        const toe = gltf.scene.getObjectByName('Toe' + side);
        toe.quaternion.copy(rest.get(toe.name).q);
      }
      gltf.scene.updateMatrixWorld(true);
      for (let iteration = 0; iteration < 5; iteration++) {
        gltf.scene.traverse((n) => {
          if (n.isSkinnedMesh) n.skeleton.update();
        });
        for (let li = 0; li < legs.length; li++) {
          const leg = legs[li],
            ideal = targetAt(leg, phase),
            centre = v();
          let lowest = Infinity;
          for (const s of leg.sole) {
            const p = s.mesh.getVertexPosition(s.i, v()).applyMatrix4(s.mesh.matrixWorld);
            centre.add(p);
            lowest = Math.min(lowest, p.y);
          }
          centre.multiplyScalar(1 / leg.sole.length);
          const correction = new THREE.Vector3(
            leg.soleCentre.x + ideal.x - leg.anchor.x - centre.x,
            leg.soleMinimum + 0.003 + ideal.y - leg.anchor.y - lowest,
            leg.soleCentre.z + ideal.z - leg.anchor.z - centre.z,
          );
          targets[li].addScaledVector(correction, 0.9);
          solveLeg(leg, targets[li], footPitch(leg, phase));
        }
        gltf.scene.updateMatrixWorld(true);
      }
      times.push(time);
      for (const b of bones) {
        const t = tracks.get(b.name);
        t.rotation.push(...b.quaternion.toArray());
        t.translation.push(...b.position.toArray());
        t.scale.push(...b.scale.toArray());
      }
    }
    const input = accessor(times, 'SCALAR'),
      replacement = { name: clip.name, samplers: [], channels: [] };
    for (const b of bones) {
      const node = doc.nodes.findIndex(
        (n) => THREE.PropertyBinding.sanitizeNodeName(n.name || '') === b.name,
      );
      if (node < 0) throw Error('Missing ' + b.name);
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
    doc.animations[ci] = replacement;
    manifest.clips.find((c) => c.name === clip.name).seconds = duration;
    manifest.locomotion[clip.name] = {
      ...manifest.locomotion[clip.name],
      metresPerSecond: stride / duration,
      cycleSeconds: duration,
      strideMetres: stride,
      dutyFactor: duty,
      method:
        'Distinct upright low-step walk and bent-elbow high-recovery run; limb-length IK refined against skinned soles',
      swingLiftMetres: lift,
    };
    changes.push({
      clip: clip.name,
      frames: frames + 1,
      sampleRate: frames / duration,
      stride,
      duty,
      lift,
      bodyClearance: clearance,
      armSwingRadians: run ? 0.68 : 0.27,
      elbowBendRadians: run ? (ape ? 0.95 : 1.3) : ape ? 0.34 : 0.2,
      forwardLeanRadians: run ? 0.16 : 0.015,
    });
  }
  doc.buffers[0].byteLength = byteLength;
  const bytes = pack(doc, Buffer.concat(chunks)),
    dir = `${base}/${revision}/${key}`;
  await mkdir(dir, { recursive: true });
  try {
    await writeFile(dir + '/model.glb', bytes, { flag: 'wx' });
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    assert.equal(
      hash(await readFile(dir + '/model.glb')),
      hash(bytes),
      'Use a new revision for changed motion',
    );
  }
  manifest.sha256 = hash(bytes);
  manifest.bytes = bytes.length;
  manifest.playerGaits = {
    revision,
    sourceSha256: hash(gltf.bytes),
    changes,
    status: 'candidate-unreviewed',
  };
  await writeFile(`${dir}/asset.json`, JSON.stringify(manifest, null, 2) + '\n');
  console.log(key, changes.length, 'gaits', manifest.sha256);
}
