import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as T from 'three';
import { CHARACTER_MODELS } from '../dist/shared/characters.mjs';
import { axeGripPlacement } from '../dist/src/character-assets.js';
import { loadMotion, pose } from '../scripts/motion-glb.mjs';

const axeAsset = JSON.parse(await readFile('public/models/stone-axe/asset.json', 'utf8'));
const axe = await loadMotion('public' + axeAsset.url);
const axePoints = [];
axe.scene.traverse((node) => {
  if (!node.isMesh) return;
  const position = node.geometry.attributes.position;
  for (let i = 0; i < position.count; i++)
    axePoints.push(new T.Vector3().fromBufferAttribute(position, i).applyMatrix4(node.matrixWorld));
});

// The axe is held across the fist instead of lying along the arm.
for (const profile of CHARACTER_MODELS)
  test(`${profile.key}: stone axe haft crosses the forearm at a right angle`, async () => {
    const asset = JSON.parse(await readFile(`public/models/${profile.key}/asset.json`, 'utf8')),
      g = await loadMotion('public' + asset.url),
      grip = g.scene.getObjectByName('GripR'),
      hand = grip.parent,
      elbow = hand.parent,
      clip = (name) => g.animations.find((c) => c.name === name),
      bones = () => {
        const values = [];
        g.scene.traverse((node) => {
          if (node.isBone) values.push(...node.quaternion.toArray(), ...node.position.toArray());
        });
        return values;
      };
    const rest = bones();
    const rotation = axeGripPlacement(g.scene, grip, clip('Idle_Loop'));
    assert.deepEqual(bones(), rest, 'placement leaves the rest pose untouched');
    const tool = new T.Group();
    tool.quaternion.copy(rotation);
    if (profile.species === 'bear') tool.scale.setScalar(0.55);
    grip.add(tool);
    const measure = () => {
      g.scene.updateMatrixWorld(true);
      const forearm = hand
          .getWorldPosition(new T.Vector3())
          .sub(elbow.getWorldPosition(new T.Vector3()))
          .normalize(),
        q = tool.getWorldQuaternion(new T.Quaternion());
      return {
        forearm,
        haft: new T.Vector3(0, 1, 0).applyQuaternion(q),
        blade: new T.Vector3(1, 0, 0).applyQuaternion(q),
        lowest: Math.min(...axePoints.map((p) => tool.localToWorld(p.clone()).y)),
      };
    };
    const idle = pose(g, clip('Idle_Loop'), 0);
    const standing = measure();
    idle.stopAllAction();
    assert.ok(Math.abs(standing.haft.dot(standing.forearm)) < 1e-4, 'haft ⟂ forearm');
    assert.ok(standing.blade.distanceTo(standing.forearm) < 1e-4, 'blade faces past the fist');
    // A hanging arm carries the haft ahead; a forward-reaching arm holds it upright.
    const hanging = Math.abs(standing.forearm.y) > Math.abs(standing.forearm.z);
    assert.ok(
      hanging ? standing.haft.z > 0.8 : standing.haft.y > 0.8,
      'haft leaves the thumb side',
    );
    // Tentacle segments bend inside the clips, so only the frame above is exact there.
    const octopus = profile.bodyPlan === 'octopus';
    for (const name of ['Idle_Loop', 'Walk_Loop', 'Run_Loop', 'Gather'])
      for (const t of [0, 0.25, 0.5, 0.75]) {
        const mixer = pose(g, clip(name), t * clip(name).duration);
        const { haft, forearm, lowest } = measure();
        mixer.stopAllAction();
        if (!octopus) assert.ok(Math.abs(haft.dot(forearm)) < 0.02, `${name}@${t}: haft ⟂ forearm`);
        assert.ok(lowest > 0.02, `${name}@${t}: axe clears the ground (${lowest.toFixed(3)} m)`);
      }
  });
