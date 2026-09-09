import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { MOTION_KEYS, loadMotion } from './motion-glb.mjs';

const output = process.argv[2] || 'output/creature-motion/baseline';
await mkdir(output, { recursive: true });
const results = [];
for (const key of MOTION_KEYS) {
  const gltf = await loadMotion(`public/models/${key}/model.glb`);
  const manifest = JSON.parse(await readFile(`public/models/${key}/asset.json`, 'utf8'));
  const bones = [];
  gltf.scene.traverse((n) => {
    if (n.isBone)
      bones.push({ name: n.name, p: n.getWorldPosition(new THREE.Vector3()).toArray() });
  });
  const clips = gltf.animations.map((clip) => {
    let loopPositionError = 0,
      loopAngleError = 0,
      maximumRotationStep = 0;
    for (const track of clip.tracks) {
      const v = track.values,
        s = track.getValueSize();
      if (track.name.endsWith('.quaternion')) {
        const q = new THREE.Quaternion().fromArray(v),
          last = new THREE.Quaternion().fromArray(v, v.length - s);
        loopAngleError = Math.max(loopAngleError, q.angleTo(last));
        for (let i = s; i < v.length; i += s) {
          const a = new THREE.Quaternion().fromArray(v, i - s),
            b = new THREE.Quaternion().fromArray(v, i);
          maximumRotationStep = Math.max(maximumRotationStep, a.angleTo(b));
        }
      } else if (track.name.endsWith('.position')) {
        loopPositionError = Math.max(
          loopPositionError,
          new THREE.Vector3()
            .fromArray(v)
            .distanceTo(new THREE.Vector3().fromArray(v, v.length - s)),
        );
      }
    }
    return {
      name: clip.name,
      seconds: clip.duration,
      tracks: clip.tracks.length,
      loopPositionError,
      loopAngleError,
      maximumRotationStep,
    };
  });
  const record = {
    key,
    sha256: createHash('sha256').update(gltf.bytes).digest('hex'),
    height: manifest.heightMetres,
    locomotion: manifest.locomotion,
    bones,
    clips,
  };
  results.push(record);
  console.log(JSON.stringify({ key, bones: bones.length, clips, locomotion: manifest.locomotion }));
}
await writeFile(
  `${output}/inventory.json`,
  JSON.stringify({ at: new Date().toISOString(), results }, null, 2) + '\n',
);
