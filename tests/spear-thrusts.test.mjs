import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as T from 'three';
import { CHARACTER_MODELS } from '../dist/shared/characters.mjs';
import { ATTACK_PROFILES } from '../dist/shared/combat-profiles.mjs';
import { CharacterAnimation } from '../dist/src/character-animation.js';
import { handGripPlacement } from '../dist/src/character-assets.js';
import { orientSpear } from '../dist/src/spear-pose.js';
import { loadMotion } from '../scripts/motion-glb.mjs';

for (const profile of CHARACTER_MODELS.filter((m) => ['cro', 'nea'].includes(m.species)))
  test(`${profile.key}: left foot steps into a two-handed spear thrust at the server impact`, async () => {
    const asset = JSON.parse(await readFile(`public/models/${profile.key}/asset.json`, 'utf8')),
      g = await loadMotion('public' + asset.url);
    assert.equal(asset.spearThrust.attachment, 'authored-grip');
    const root = new T.Group();
    root.add(g.scene);
    const placement = handGripPlacement(g.scene),
      weapon = new T.Group();
    placement.grip.add(weapon);
    const animation = new CharacterAnimation(g.scene, g.animations, {
        walkSpeed: asset.locomotion.Walk_Loop.metresPerSecond,
        runSpeed: asset.locomotion.Run_Loop.metresPerSecond,
      }),
      pos = (name) => g.scene.getObjectByName(name).getWorldPosition(new T.Vector3());
    animation.update(0.2, 2, false);
    assert.equal(animation.name, 'Walk_Loop');
    animation.playAttack(0);
    animation.blender.update(0.1);
    animation.current.time = 0;
    animation.mixer.update(0);
    root.updateMatrixWorld(true);
    const startLeft = pos('FootL'),
      startRight = pos('FootR');
    for (const name of ['spear', 'obsidianSpear']) {
      const attack = ATTACK_PROFILES[name];
      const toolAsset = JSON.parse(
        await readFile(`public/models/${attack.modelKey}/asset.json`, 'utf8'),
      );
      const tool = await loadMotion('public' + toolAsset.url);
      const bounds = new T.Box3().setFromObject(tool.scene);
      assert.ok(Math.abs(animation.current.getClip().duration - attack.durationMs / 1000) < 1e-6);
      animation.current.time = attack.impactMs / 1000;
      animation.mixer.update(0);
      for (const heading of [0, Math.PI / 2, Math.PI, -Math.PI / 3]) {
        root.rotation.y = heading;
        orientSpear(weapon, root, true, placement.rotation, true, attack.impactMs / 1000);
        root.updateMatrixWorld(true);
        const direction = new T.Vector3(0, 1, 0).applyQuaternion(
            weapon.getWorldQuaternion(new T.Quaternion()),
          ),
          expected = new T.Vector3(Math.sin(heading), 0, Math.cos(heading));
        assert.ok(direction.distanceTo(expected) < 0.001, 'spear follows facing at impact');
        const delta = pos('GripL').sub(pos('GripR')),
          along = delta.dot(direction);
        assert.ok(along > 0.24 && along < 0.4, 'left hand guides ahead of the right');
        assert.ok(
          delta.addScaledVector(direction, -along).length() < 0.001,
          'shaft passes through left grip',
        );
        assert.ok(
          weapon.localToWorld(new T.Vector3(0, -0.5, 0)).distanceTo(pos('GripR')) < 1e-6,
          'right hand never releases',
        );
        const rear = weapon.worldToLocal(pos('GripR')),
          front = weapon.worldToLocal(pos('GripL'));
        assert.ok(
          rear.y - bounds.min.y > 0.2 && rear.y - bounds.min.y < 0.23,
          'rear hand holds about 21 cm from the actual spear butt',
        );
        assert.ok(
          front.y - bounds.min.y > 0.52 && front.y - bounds.min.y < 0.59,
          'front hand also holds the rear part of the shaft',
        );
      }
    }
    root.rotation.y = 0;
    root.updateMatrixWorld(true);
    assert.ok(pos('FootL').z - startLeft.z > 0.4, 'left foot steps forward');
    assert.ok(Math.abs(pos('FootR').z - startRight.z) < 0.05, 'right foot supports');
    assert.deepEqual(g.scene.getObjectByName('Root').position.toArray(), [0, 0, 0]);
    animation.update(0.5, 0, false);
    animation.update(0.2, 0, false);
    assert.equal(animation.name, 'Idle_Loop');
    orientSpear(weapon, root, false, placement.rotation, true, animation.current.time);
    assert.equal(weapon.position.length(), 0, 'ordinary carry grip is restored');
    animation.playAttack(0.333);
    animation.blender.update(0.1);
    animation.mixer.update(0);
    assert.ok(
      Math.abs(animation.current.time - 0.333) < 1e-5,
      'late load seeks rather than replays',
    );
    animation.update(0.6, 5.6, true);
    animation.update(0.2, 5.6, true);
    assert.equal(animation.name, 'Run_Loop');
    animation.dispose();
  });
