import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { MOTION_KEYS, loadMotion } from './motion-glb.mjs';

const base = 'output/creature-motion',
  revision = process.argv[2] || 'revision-04',
  results = [];
for (const key of MOTION_KEYS) {
  const before = await loadMotion(`${base}/baseline/${key}/model.glb`),
    after = await loadMotion(`${base}/${revision}/${key}/model.glb`);
  assert.deepEqual(
    after.binary.subarray(0, before.binary.length),
    before.binary,
    `${key} source binary preserved`,
  );
  for (const field of ['nodes', 'meshes', 'skins', 'materials', 'textures', 'images'])
    assert.deepEqual(after.doc[field], before.doc[field], `${key} ${field} preserved`);
  const manifest = JSON.parse(await readFile(`${base}/${revision}/${key}/asset.json`, 'utf8'));
  const clips = [];
  for (let ci = 0; ci < after.animations.length; ci++) {
    const clip = after.animations[ci],
      old = before.animations[ci],
      gait = ['Walk_Loop', 'Run_Loop'].includes(clip.name);
    assert.equal(clip.name, old.name);
    assert.ok(Math.abs(clip.duration - old.duration) < 1e-5);
    if (!gait) assert.deepEqual(after.doc.animations[ci], before.doc.animations[ci]);
    for (const track of clip.tracks) assert.ok([...track.values].every(Number.isFinite));
    const angularStep = (clip) =>
      Math.max(
        ...clip.tracks
          .filter((t) => t.name.endsWith('.quaternion'))
          .map((t) => {
            const interpolant = t.createInterpolant();
            let maximum = 0;
            for (let i = 1; i <= Math.ceil(clip.duration * 30); i++) {
              const time = Math.min(i / 30, clip.duration),
                a = new THREE.Quaternion()
                  .fromArray(interpolant.evaluate(Math.max(0, time - 1 / 30)))
                  .normalize(),
                b = new THREE.Quaternion().fromArray(interpolant.evaluate(time)).normalize();
              maximum = Math.max(maximum, a.angleTo(b));
            }
            return maximum;
          }),
      );
    const item = {
      name: clip.name,
      changed: gait,
      maximumRotationPer30HzBefore: angularStep(old),
      maximumRotationPer30HzAfter: angularStep(clip),
    };
    if (gait) {
      const asset = manifest.locomotion[clip.name],
        quad = key === 'woolly-mammoth',
        feet = quad ? ['HindLFoot', 'ForeLFoot', 'HindRFoot', 'ForeRFoot'] : ['FootL', 'FootR'];
      const metrics = [];
      for (const [label, gltf, c] of [
        ['before', before, old],
        ['after', after, clip],
      ]) {
        const mixer = new THREE.AnimationMixer(gltf.scene),
          action = mixer.clipAction(c).setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
        action.play();
        const paths = feet.map(() => []),
          count = Math.ceil(c.duration * 120);
        for (let i = 0; i <= count; i++) {
          action.time = (i / count) * c.duration;
          mixer.update(0);
          gltf.scene.updateMatrixWorld(true);
          feet.forEach((name, index) =>
            paths[index].push(
              gltf.scene.getObjectByName(name).getWorldPosition(new THREE.Vector3()),
            ),
          );
        }
        for (let fi = 0; fi < feet.length; fi++) {
          const errors = [],
            heights = [],
            xs = [];
          for (let i = 1; i <= count; i++) {
            const phase = (i / count + fi * (quad ? 0.25 : 0.5)) % 1;
            if (phase < 0.04 || phase > asset.dutyFactor - 0.04) continue;
            const p = paths[fi][i],
              prev = paths[fi][i - 1];
            errors.push((p.z - prev.z) / (c.duration / count) + asset.metresPerSecond);
            heights.push(p.y);
            xs.push(p.x);
          }
          metrics.push({
            version: label,
            foot: feet[fi],
            speedErrorRms: Math.sqrt(errors.reduce((s, x) => s + x * x, 0) / errors.length),
            ankleHeightRange: Math.max(...heights) - Math.min(...heights),
            lateralRange: Math.max(...xs) - Math.min(...xs),
          });
        }
        mixer.stopAllAction();
        mixer.uncacheRoot(gltf.scene);
      }
      item.support = metrics;
      // The ankle now compensates for the actual weighted sole deformation.
      // Sole surface contact is checked separately, so an immobile ankle is not
      // incorrectly required of a deforming foot.
      for (const m of metrics.filter((m) => m.version === 'after')) {
        assert.ok(
          m.speedErrorRms < 0.18,
          `${key} ${clip.name} ${m.foot} unexpected ankle speed ${m.speedErrorRms}`,
        );
        assert.ok(
          m.ankleHeightRange < 0.06,
          `${key} unexpected ankle height ${m.ankleHeightRange}`,
        );
      }
    }
    clips.push(item);
  }
  results.push({ key, clips });
  console.log(key, clips.length, 'clips verified');
}
await writeFile(
  `${base}/${revision}/validation.json`,
  JSON.stringify(
    {
      at: new Date().toISOString(),
      scope:
        'Exact GLB structure, animation samples and ankle support; skin surfaces and visual appearance require separate review',
      results,
    },
    null,
    2,
  ) + '\n',
);
