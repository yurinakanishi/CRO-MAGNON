import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CharacterAnimation, HUMAN_CLIPS } from '../dist/src/character-animation.js';
import { JumpPose } from '../dist/src/jump-pose.js';
import { RidingPose } from '../dist/src/riding-pose.js';
import { loadMotion } from '../scripts/motion-glb.mjs';
import { CHARACTER_MODELS } from '../dist/shared/characters.mjs';
import { readFile } from 'node:fs/promises';

for (const { key } of CHARACTER_MODELS)
  test(
    key + ': Downed interrupts, seeks, holds, and recovers on the delivered skeleton',
    async () => {
      const asset = JSON.parse(await readFile(`public/models/${key}/asset.json`, 'utf8'));
      const gltf = await loadMotion('public' + asset.url);
      const jump = new JumpPose(gltf.scene),
        riding = new RidingPose(gltf.scene);
      const animation = new CharacterAnimation(gltf.scene, gltf.animations, {
        walkSpeed: 1,
        runSpeed: 3,
      });
      assert.ok(animation.actions.has('Downed'));
      assert.ok(HUMAN_CLIPS.every((n) => animation.actions.has(n)));
      const positions = () => {
        gltf.scene.updateMatrixWorld(true);
        return ['Hips', 'Chest', 'Head'].map((n) =>
          gltf.scene.getObjectByName(n).getWorldPosition(new THREE.Vector3()).toArray(),
        );
      };
      const seek = (time) => {
        animation.updateDowned(0.016, time);
        return positions();
      };
      const expected = seek(1.4);
      for (const from of ['Idle_Loop', 'Walk_Loop', 'Run_Loop', 'Attack', 'Jump', 'Ride']) {
        animation.leaveDowned();
        if (from === 'Jump') {
          jump.update(animation, 0.5);
          jump.leave(animation);
        } else if (from === 'Ride') {
          riding.update(animation, 1, 0);
          riding.leave(animation);
        } else {
          animation.change(from, 0);
          animation.update(
            0.15,
            from === 'Run_Loop' ? 3 : from === 'Walk_Loop' ? 1 : 0,
            from === 'Run_Loop',
          );
        }
        assert.deepEqual(seek(1.4), expected, from + ' to downed must seek deterministically');
      }
      const final = seek(1.8);
      assert.deepEqual(seek(20), final);
      animation.update(20, 10, true);
      assert.equal(animation.name, 'Downed');
      assert.deepEqual(positions(), final);
      assert.equal(animation.play('Wave'), false);
      assert.equal(animation.playAttack(0), false);
      animation.leaveDowned();
      animation.update(0.2, 0);
      assert.equal(animation.name, 'Idle_Loop');
      animation.update(0.2, 3, true);
      assert.equal(animation.name, 'Run_Loop');
      assert.equal(animation.playAttack(0), true);
      animation.dispose();
    },
  );
