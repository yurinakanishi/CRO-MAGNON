import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { MOTION_KEYS, loadMotion, pack } from './motion-glb.mjs';

const base = 'output/creature-motion',
  revision = process.argv[2] || 'revision-04';
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
function solveLeg(leg, target) {
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
  worldRotate(leg.foot, leg.orientation);
}

for (const key of MOTION_KEYS) {
  const source = `public/models/${key}`;
  await mkdir(`${base}/baseline/${key}`, { recursive: true });
  for (const name of ['model.glb', 'asset.json']) {
    try {
      await copyFile(`${source}/${name}`, `${base}/baseline/${key}/${name}`, 1);
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
  }
  const gltf = await loadMotion(`${base}/baseline/${key}/model.glb`),
    { doc, binary } = gltf;
  const manifest = JSON.parse(await readFile(`${base}/baseline/${key}/asset.json`, 'utf8'));
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
  const quadruped = key === 'woolly-mammoth';
  const legs = (quadruped ? ['HindL', 'ForeL', 'HindR', 'ForeR'] : ['L', 'R']).map(
    (side, index) => {
      const upper = gltf.scene.getObjectByName(quadruped ? side + 'Upper' : 'UpperLeg' + side),
        lower = gltf.scene.getObjectByName(quadruped ? side + 'Lower' : 'LowerLeg' + side),
        foot = gltf.scene.getObjectByName(quadruped ? side + 'Foot' : 'Foot' + side);
      return {
        upper,
        lower,
        foot,
        anchor: foot.getWorldPosition(v()),
        orientation: foot.getWorldQuaternion(q()),
        a: upper.getWorldPosition(v()).distanceTo(lower.getWorldPosition(v())),
        b: lower.getWorldPosition(v()).distanceTo(foot.getWorldPosition(v())),
        bend: side.startsWith('Fore') ? -1 : 1,
        phase: quadruped ? index * 0.25 : index * 0.5,
      };
    },
  );
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
    leg.sole = sole.filter((_, i) => i % Math.max(1, Math.floor(sole.length / 48)) === 0);
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
    const mixer = new THREE.AnimationMixer(gltf.scene),
      action = mixer.clipAction(clip).setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();
    const run = clip.name === 'Run_Loop',
      duration = clip.duration,
      frames = Math.round(duration * 60),
      height = manifest.heightMetres;
    const stride = manifest.locomotion[clip.name].metresPerSecond * duration;
    const duty = quadruped ? (run ? 0.6 : 0.72) : run ? 0.34 : 0.62,
      lift =
        Math.min(...legs.map((l) => l.a + l.b)) *
        (quadruped
          ? run
            ? 0.09
            : 0.05
          : run
            ? key === 'desert-fennec-mage'
              ? 0.15
              : 0.25
            : 0.13);
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
      action.time = (frame / frames) * duration;
      mixer.update(0);
      gltf.scene.updateMatrixWorld(true);
      let required = 0;
      for (const leg of legs) {
        const top = leg.upper.getWorldPosition(v()),
          target = targetAt(leg, frame / frames),
          reach = (leg.a + leg.b) * 0.975,
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
      action.time = frame === frames ? 0 : time;
      mixer.update(0);
      gltf.scene.updateMatrixWorld(true);
      const hips = gltf.scene.getObjectByName('Hips');
      // The imported body's existing motion is retained. Its height is lowered
      // only as required by the measured limb lengths and the new planted feet.
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
      for (let li = 0; li < legs.length; li++) solveLeg(legs[li], targets[li]);
      // The toes follow the planted foot as one continuous surface. Source toe
      // curls otherwise counter-rotate the flattened ankle at heel strike.
      if (!quadruped)
        for (const side of ['L', 'R']) {
          const toe = gltf.scene.getObjectByName('Toe' + side);
          toe.quaternion.copy(rest.get(toe.name).q);
        }
      gltf.scene.updateMatrixWorld(true);
      for (let iteration = 0; iteration < 3; iteration++) {
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
            leg.soleMinimum + ideal.y - leg.anchor.y - lowest,
            leg.soleCentre.z + ideal.z - leg.anchor.z - centre.z,
          );
          targets[li].addScaledVector(correction, 0.9);
          solveLeg(leg, targets[li]);
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
    manifest.locomotion[clip.name] = {
      ...manifest.locomotion[clip.name],
      strideMetres: stride,
      dutyFactor: duty,
      method:
        'Fixed sole support and continuous swing; two-segment IK using delivered bone lengths, refined against skinned sole samples',
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
    });
    mixer.stopAllAction();
    mixer.uncacheRoot(gltf.scene);
  }
  doc.buffers[0].byteLength = byteLength;
  const bytes = pack(doc, Buffer.concat(chunks)),
    dir = `${base}/${revision}/${key}`;
  await mkdir(dir, { recursive: true });
  await writeFile(`${dir}/model.glb`, bytes);
  manifest.sha256 = hash(bytes);
  manifest.bytes = bytes.length;
  manifest.motionReview = {
    revision,
    sourceSha256: hash(gltf.bytes),
    changes,
    status: 'candidate-unreviewed',
  };
  await writeFile(`${dir}/asset.json`, JSON.stringify(manifest, null, 2) + '\n');
  console.log(key, changes.length, 'gaits', manifest.sha256);
}
