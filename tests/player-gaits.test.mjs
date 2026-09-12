import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { CHARACTER_MODELS } from '../dist/shared/characters.mjs';
import { CharacterAnimation } from '../dist/src/character-animation.js';
import { loadMotion } from '../scripts/motion-glb.mjs';

for (const profile of CHARACTER_MODELS)
  test(`${profile.key}: delivered walk and run visibly differ and switch on the real skin`, async () => {
    const asset = JSON.parse(await readFile(`public/models/${profile.key}/asset.json`, 'utf8'));
    const gltf = await loadMotion('public' + asset.url);
    const animation = new CharacterAnimation(gltf.scene, gltf.animations, {
      walkSpeed: asset.locomotion.Walk_Loop.metresPerSecond,
      runSpeed: asset.locomotion.Run_Loop.metresPerSecond,
    });
    const pos = (name) => gltf.scene.getObjectByName(name).getWorldPosition(new THREE.Vector3());
    const motions = [];
    for (const running of [false, true]) {
      const name = running ? 'Run_Loop' : 'Walk_Loop',
        speed = asset.locomotion[name].metresPerSecond;
      animation.update(0.2, speed, running);
      assert.equal(animation.name, name);
      const action = animation.current,
        duration = action.getClip().duration;
      let elbow = 0,
        low = Infinity,
        high = -Infinity;
      for (let i = 0; i < 60; i++) {
        action.time = (duration * i) / 60;
        animation.mixer.update(0);
        gltf.scene.updateMatrixWorld(true);
        const joint = pos('LowerArmL');
        elbow += Math.PI - pos('UpperArmL').sub(joint).angleTo(pos('HandL').sub(joint));
        const height = pos('FootL').y;
        low = Math.min(low, height);
        high = Math.max(high, height);
      }
      motions.push({ elbow: elbow / 60, footRange: high - low });
    }
    assert.ok(motions[1].elbow > motions[0].elbow + 0.4, 'run bends the elbows distinctly');
    assert.ok(motions[1].footRange > motions[0].footRange * 2.5, 'run lifts the feet distinctly');
    animation.update(0.2, asset.locomotion.Walk_Loop.metresPerSecond, false);
    assert.equal(animation.name, 'Walk_Loop');
    animation.update(0.2, 0, true);
    assert.equal(animation.name, 'Idle_Loop');
    animation.dispose();
  });
