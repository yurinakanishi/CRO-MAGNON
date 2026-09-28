// Evaluate the exact Howkey surface under the game's live crouch solver.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import * as T from 'three';
import { loadMotion } from '../../../scripts/motion-glb.mjs';
import { GroundPettingPose } from '../../../dist/src/ground-petting-pose.js';
import { createRimoNeko, handleRimoNekoAction } from '../../../dist/shared/rimo-neko.mjs';
import { CollisionWorld } from '../../../dist/shared/collision.mjs';
const asset = JSON.parse(await readFile('public/models/howkey-scientist/asset.json', 'utf8')),
  actor = await loadMotion('public' + asset.url),
  catAsset = JSON.parse(await readFile('public/models/rimo-neko/asset.json', 'utf8')),
  cat = await loadMotion('public' + catAsset.url),
  collision = new CollisionWorld([], { coast: false, river: false, walkSurfaces: [] }),
  c = createRimoNeko(collision),
  p = {
    id: 'p',
    x: c.x,
    z: c.z - 2,
    facing: 0,
    radius: 0.32,
    species: 'howkey',
    gender: 'female',
    speed: 0,
    attackAt: 0,
    attackSequence: 0,
    jumpAt: 0,
    jumpSequence: 0,
  },
  room = { collision, rimoNeko: c, players: new Map([[p.id, p]]) };
assert.ok(handleRimoNekoAction(room, p, 'petRimo', 10000));
cat.scene.position.set(c.petGoal.x - p.x, 0, c.petGoal.z - p.z);
cat.scene.rotation.y = Math.PI;
const world = new T.Group();
world.add(actor.scene, cat.scene);
const pose = new GroundPettingPose(actor.scene),
  mixer = new T.AnimationMixer(actor.scene),
  cm = new T.AnimationMixer(cat.scene);
mixer.clipAction(actor.animations.find((a) => a.name === 'Idle_Loop')).play();
const pet = cm.clipAction(cat.animations.find((a) => a.name === 'Pet')).play();
const meshes = [];
actor.scene.traverse((o) => {
  if (o.isSkinnedMesh) meshes.push(o);
});
const q = new T.Vector3(),
  records = [];
for (const yaw of [0, Math.PI / 2, Math.PI])
  for (const stroke of [0, 0.0625, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1]) {
    pose.restore();
    mixer.update(0.03);
    world.rotation.y = yaw;
    pet.time = stroke * 1.599;
    cm.update(0);
    world.updateMatrixWorld(true);
    const base = new Map();
    actor.scene.traverse((o) => {
      if (o.isBone) base.set(o, { q: o.quaternion.clone(), p: o.position.clone() });
    });
    pose.update(
      cat.scene.getObjectByName('PetContact').getWorldPosition(new T.Vector3()),
      1,
      stroke,
    );
    world.updateMatrixWorld(true);
    let minY = Infinity,
      worst;
    for (const mesh of meshes) {
      mesh.skeleton.update();
      for (let i = 0; i < mesh.geometry.attributes.position.count; i++) {
        mesh.getVertexPosition(i, q).applyMatrix4(mesh.matrixWorld);
        if (q.y < minY) {
          minY = q.y;
          worst = {
            index: i,
            rest: new T.Vector3()
              .fromBufferAttribute(mesh.geometry.attributes.position, i)
              .toArray(),
            skin: [0, 1, 2, 3].map((k) => ({
              bone: mesh.skeleton.bones[mesh.geometry.attributes.skinIndex.getComponent(i, k)].name,
              weight: mesh.geometry.attributes.skinWeight.getComponent(i, k),
            })),
          };
        }
      }
    }
    const gap = pose.contact.distanceTo(pose.requested);
    records.push({ yaw, stroke, minY, gap, depth: pose.depth, worst });
    pose.restore();
    for (const [bone, b] of base) {
      assert.ok(bone.position.distanceTo(b.p) < 1e-8);
      assert.ok(bone.quaternion.equals(b.q), `${bone.name} restores exactly`);
    }
  }
const passed = records.every((r) => r.minY > -0.006 && r.gap < 0.045);
await writeFile(
  'output/model-generation/models/howkey-scientist/qa/runtime-crouch.json',
  JSON.stringify(
    {
      sha256: asset.sha256,
      pass: passed,
      vertices: meshes.reduce((n, m) => n + m.geometry.attributes.position.count, 0),
      records,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  JSON.stringify({
    poses: records.length,
    minY: Math.min(...records.map((r) => r.minY)),
    maxHandGap: Math.max(...records.map((r) => r.gap)),
    restoresAllBones: true,
  }),
);
assert.ok(passed, 'runtime surface or hand contact gate failed');
