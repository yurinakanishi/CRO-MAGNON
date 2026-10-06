import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  caveInteriorWeight,
  caveTorchAvailable,
  caveTorchLit,
  toggleCaveTorch,
  CAVE_TORCH,
} from '../dist/shared/cave-light.mjs';
import { caveWorldAt } from '../dist/shared/camp-cave-layout.mjs';
import { CaveTorch, TorchHoldPose } from '../dist/src/cave-torch.js';
import { TorchGrasp } from '../dist/src/torch-grasp.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { readFile } from 'node:fs/promises';
import { configureActorPerformance, updateActorPerformance } from '../dist/src/performance-lod.js';
import { CHARACTER_MODELS } from '../dist/shared/characters.mjs';
import { loadMotion } from '../scripts/motion-glb.mjs';
import { deliveredModel } from './delivered-model.mjs';
import { EventEmitter } from 'node:events';
import { createGameCore } from '../dist/application/game-core.mjs';

test('daylight fades under the measured roof, excluding the apron, solid rock and mountain above', () => {
  assert.equal(caveInteriorWeight({ x: 50, z: 50 }), 0);
  assert.equal(caveInteriorWeight(caveWorldAt(13)), 0);
  const weights = [10, 8, 5, 1, -21].map((z) => caveInteriorWeight(caveWorldAt(z)));
  assert.ok(weights[0] > 0 && weights[0] < weights[1]);
  assert.ok(weights[1] < weights[2] && weights[2] < weights[3]);
  assert.equal(weights.at(-1), 1);
  assert.equal(caveInteriorWeight({ ...caveWorldAt(-21), y: 40 }), 0);
  assert.equal(caveInteriorWeight(caveWorldAt(-21, 35)), 0);
});

test('cave entry equips a personal torch; switching it never changes someone else or the shared hearth', () => {
  const a = caveWorldAt(-21),
    b = caveWorldAt(-22);
  assert.equal(caveTorchLit(a), true);
  assert.equal(toggleCaveTorch(a), true);
  assert.equal(caveTorchLit(a), false);
  assert.equal(caveTorchAvailable(a), true, 'an extinguished torch stays held');
  assert.equal(caveTorchLit(b), true);
  assert.equal(toggleCaveTorch(a), true);
  assert.equal(caveTorchLit(a), true);
  for (const state of [
    { x: 50, z: 50 },
    { downedUntil: 1 },
    { mountId: 'm' },
    { boatId: 'b' },
    { carrierId: 'p' },
    { passengerId: 'p' },
  ]) {
    assert.equal(caveTorchLit({ ...a, ...state }), false);
    assert.equal(toggleCaveTorch({ ...a, ...state }), false);
  }
  const attenuation = (d) =>
    Math.max(0, 1 - (d / CAVE_TORCH.distance) ** 4) ** 2 / d ** CAVE_TORCH.decay;
  assert.ok(
    attenuation(3.5) < attenuation(1) * 0.035,
    'far wall is only a small fraction of the close light',
  );
  assert.equal(attenuation(5), 0);
});

test('all nine delivered rigs hold the torch while walking and restore every bone without moving the feet', async () => {
  for (const character of CHARACTER_MODELS) {
    const gltf = await loadMotion(await deliveredModel(character.key));
    const model = new THREE.Group();
    model.add(gltf.scene);
    const asset = JSON.parse(
      await readFile(
        new URL(`../public/models/${character.key}/asset.json`, import.meta.url),
        'utf8',
      ),
    );
    const grasp = new TorchGrasp(
      gltf.scene,
      THREE.MathUtils.clamp(asset.heightMetres * 0.021, 0.017, 0.044),
    );
    const pose = new TorchHoldPose(gltf.scene, grasp);
    const mixer = new THREE.AnimationMixer(gltf.scene);
    for (const clip of ['Idle_Loop', 'Walk_Loop', 'Run_Loop']) {
      mixer.stopAllAction();
      mixer
        .clipAction(gltf.animations.find((c) => c.name === clip))
        .reset()
        .play();
      for (const yaw of [0, Math.PI / 2, Math.PI]) {
        model.rotation.y = yaw;
        for (let frame = 0; frame < 60; frame++) {
          pose.restore();
          mixer.update(1 / 30);
          model.updateMatrixWorld(true);
          const bones = [];
          gltf.scene.traverse((b) => {
            if (b.isBone) bones.push([b, b.position.clone(), b.quaternion.clone()]);
          });
          const feet = ['FootL', 'FootR']
            .map((n) => gltf.scene.getObjectByName(n))
            .filter(Boolean)
            .map((b) => [b, b.getWorldPosition(new THREE.Vector3())]);
          pose.update(true, 1 / 30);
          const grip = pose.grip.getWorldPosition(new THREE.Vector3());
          assert.ok(grip.toArray().every(Number.isFinite), character.key);
          if (pose.weight > 0.98) {
            const joint = (name) =>
              model.worldToLocal(
                gltf.scene.getObjectByName(name).getWorldPosition(new THREE.Vector3()),
              );
            const shoulder = joint('UpperArmL'),
              elbow = joint('LowerArmL'),
              wrist = joint('HandL');
            const reach = shoulder.distanceTo(elbow) + elbow.distanceTo(wrist);
            assert.ok(
              elbow.x > shoulder.x + reach * 0.1,
              `${character.key}/${clip}: elbow stays outside the shoulder`,
            );
            assert.ok(
              wrist.x > shoulder.x + reach * 0.2,
              `${character.key}/${clip}: hand never crosses the torso`,
            );
            assert.ok(
              elbow.y < shoulder.y - reach * 0.25,
              `${character.key}/${clip}: relaxed upper arm`,
            );
            const angle = shoulder.clone().sub(elbow).angleTo(wrist.clone().sub(elbow));
            assert.ok(
              angle > 0.75 && angle < 2.4,
              `${character.key}/${clip}: bent, non-inverted elbow`,
            );
          }
          for (const [foot, at] of feet)
            assert.ok(foot.getWorldPosition(new THREE.Vector3()).distanceTo(at) < 1e-9);
          pose.restore();
          for (const [bone, p, q] of bones) {
            assert.deepEqual(bone.position.toArray(), p.toArray());
            assert.deepEqual(bone.quaternion.toArray(), q.toArray());
          }
        }
      }
    }
    mixer.stopAllAction();
    mixer.uncacheRoot(gltf.scene);
    grasp.dispose();
  }
});

test('all nine hands curl only their original left-hand surface; LOD, other actors and unequipping preserve source geometry', async () => {
  for (const character of CHARACTER_MODELS) {
    const asset = JSON.parse(
      await readFile(
        new URL(`../public/models/${character.key}/asset.json`, import.meta.url),
        'utf8',
      ),
    );
    const gltf = await loadMotion(await deliveredModel(character.key));
    const lod = await loadMotion(new URL(`../public${asset.lods[0].url}`, import.meta.url));
    const a = clone(gltf.scene),
      b = clone(gltf.scene);
    configureActorPerformance(a, lod.scene, asset);
    configureActorPerformance(b, lod.scene, asset);
    const source = a.userData.actorDetail.meshes.map((entry) => ({
      high: entry.high,
      low: entry.low,
    }));
    const diameter = THREE.MathUtils.clamp(asset.heightMetres * 0.021, 0.017, 0.044);
    const first = new TorchGrasp(a, diameter),
      second = new TorchGrasp(b, diameter);
    let totalChanged = 0;
    for (const [index, entry] of a.userData.actorDetail.meshes.entries()) {
      assert.equal(
        entry.high,
        b.userData.actorDetail.meshes[index].high,
        'same model shares the grip geometry',
      );
      for (const level of ['high', 'low']) {
        const g = entry[level],
          original = source[index][level],
          target = g.morphAttributes.position?.at(-1);
        assert.deepEqual(g.attributes.position.array, original.attributes.position.array);
        assert.deepEqual(g.attributes.uv.array, original.attributes.uv.array);
        assert.deepEqual(g.attributes.skinIndex.array, original.attributes.skinIndex.array);
        assert.deepEqual(g.attributes.skinWeight.array, original.attributes.skinWeight.array);
        assert.deepEqual(g.index?.array, original.index?.array);
        if (!target) {
          assert.equal(g, original);
          continue;
        }
        let changed = 0;
        const hand = entry.mesh.skeleton.bones.findIndex((bone) => bone.name === 'HandL');
        for (let i = 0; i < target.count; i++) {
          const delta = new THREE.Vector3().fromBufferAttribute(target, i);
          assert.ok(delta.toArray().every(Number.isFinite));
          if (delta.lengthSq() < 1e-16) continue;
          changed++;
          assert.ok(
            [0, 1, 2, 3].some(
              (j) =>
                g.attributes.skinIndex.getComponent(i, j) === hand &&
                g.attributes.skinWeight.getComponent(i, j) > 0.01,
            ),
            'only left-hand vertices curl',
          );
          assert.ok(
            delta.length() < asset.heightMetres * 0.2,
            `${character.key}: bounded finger motion`,
          );
        }
        totalChanged += changed;
      }
    }
    assert.ok(totalChanged > 0, `${character.key}: fingers actually curl`);
    first.update(1);
    updateActorPerformance(a, 50);
    for (const entry of a.userData.actorDetail.meshes) {
      assert.equal(entry.mesh.geometry, entry.low);
      if (entry.mesh.morphTargetDictionary?.TorchGrasp !== undefined)
        assert.equal(entry.mesh.morphTargetInfluences.at(-1), 1);
    }
    for (const entry of b.userData.actorDetail.meshes)
      if (entry.mesh.morphTargetDictionary?.TorchGrasp !== undefined)
        assert.equal(entry.mesh.morphTargetInfluences.at(-1), 0);
    first.update(0);
    first.dispose();
    for (const [index, entry] of a.userData.actorDetail.meshes.entries()) {
      assert.equal(entry.high, source[index].high);
      assert.equal(entry.low, source[index].low);
      assert.equal(entry.mesh.geometry, source[index].low);
    }
    second.update(1);
    assert.ok(
      b.userData.actorDetail.meshes.some((entry) => entry.mesh.morphTargetInfluences?.at(-1) === 1),
    );
    second.dispose();
  }
});

test('the real torch has a slim shaft, follows its palm and releases the grip when hidden', async () => {
  const gltf = await loadMotion(await deliveredModel('cro-magnon-woman'));
  const wood = await loadMotion(new URL('../public/models/firewood-log/lod1.glb', import.meta.url));
  const scene = new THREE.Scene();
  scene.add(gltf.scene);
  const torch = new CaveTorch(scene, { create: () => clone(wood.scene) }, gltf.scene, 1.65);
  const size = new THREE.Box3().setFromObject(torch.root.children[0]).getSize(new THREE.Vector3());
  assert.ok(size.x > 0.028 && size.x < 0.04);
  assert.ok(size.z > 0.028 && size.z < 0.04);
  assert.ok(size.y > 0.6 && size.y < 0.7);
  for (const yaw of [0, Math.PI / 2, Math.PI]) {
    gltf.scene.rotation.y = yaw;
    torch.update(true, 1, 1, 1);
    assert.ok(
      torch.root.position.distanceTo(torch.pose.grip.getWorldPosition(new THREE.Vector3())) < 1e-9,
    );
    assert.ok(new THREE.Vector3(0, 1, 0).applyQuaternion(torch.root.quaternion).y > 0.95);
  }
  torch.update(true, 1, 1, 1, false);
  assert.equal(torch.root.visible, true);
  assert.equal(torch.light.visible, false);
  assert.equal(torch.light.intensity, 0);
  assert.equal(torch.root.children.at(-1).visible, false, 'no flame when extinguished');
  assert.ok(torch.pose.weight > 0.99);
  assert.ok(
    torch.root.position.distanceTo(torch.pose.grip.getWorldPosition(new THREE.Vector3())) < 1e-9,
  );
  torch.update(true, 2, 1, 1, true);
  assert.equal(torch.root.visible, true);
  assert.equal(torch.light.visible, true);
  assert.equal(torch.root.children.at(-1).visible, true);
  torch.hide();
  assert.equal(torch.root.visible, false);
  gltf.scene.traverse((mesh) => {
    if (mesh.isSkinnedMesh && mesh.morphTargetDictionary?.TorchGrasp !== undefined)
      assert.equal(mesh.morphTargetInfluences.at(-1), 0);
  });
  torch.dispose();
  assert.equal(gltf.scene.getObjectByName('TorchGrip'), undefined);
});

test('five command connections receive personal torch switches and exiting re-arms automatic entry', () => {
  class Socket extends EventEmitter {
    readyState = 1;
    bufferedAmount = 0;
    messages = [];
    send(raw) {
      this.messages.push(JSON.parse(raw));
    }
    ping() {
      this.emit('pong');
    }
    close() {
      this.readyState = 3;
      this.emit('close');
    }
  }
  let now = 10000,
    id = 0;
  const core = createGameCore({
    runtime: { now: () => now, id: () => `torch-${++id}`, token: () => `torch-session-${++id}` },
  });
  const sockets = Array.from({ length: 5 }, () => {
    const socket = new Socket();
    core.connect(socket, new URLSearchParams({ room: 'TORCH' }));
    return socket;
  });
  const room = core.rooms.get('TORCH'),
    p = [...room.players.values()][0];
  Object.assign(p, caveWorldAt(-21));
  p.inventory.wood = 7;
  sockets[0].emit(
    'message',
    Buffer.from(JSON.stringify({ type: 'action', action: 'toggleCaveTorch' })),
    false,
  );
  assert.equal(p.caveTorchOff, true);
  for (const socket of sockets) {
    const state = socket.messages.filter((m) => m.type === 'state').at(-1);
    assert.equal(state.players.find((value) => value.id === p.id).caveTorchOff, true);
    assert.equal(state.players.filter((value) => value.caveTorchOff).length, 1);
  }
  Object.assign(p, { x: 50, z: 50 });
  now += 500;
  core.tick();
  assert.equal(p.caveTorchOff, false);
  Object.assign(p, caveWorldAt(-21));
  assert.equal(caveTorchLit(p), true);
  assert.equal(p.inventory.wood, 7);
  assert.equal(room.camp.caveFireLit, false);
  sockets.forEach((s) => s.close());
});
