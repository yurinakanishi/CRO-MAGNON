// Measure the exact delivered gesture, including seams and its four planted paws.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { loadMotion, pose } from './motion-glb.mjs';

const revision = process.argv[2] || '10';
const base = process.argv[3] || 'output/model-generation/models/rimo-neko';
const file = `${base}/work/rig/revision-${revision}/candidate.glb`;
const gltf = await loadMotion(file);
const meshes = [];
gltf.scene.traverse(n => { if (n.isSkinnedMesh) meshes.push(n); });
const feet = ['HandL', 'HandR', 'FootL', 'FootR'].map(n => gltf.scene.getObjectByName(n));
const head = gltf.scene.getObjectByName('Head'), tail = gltf.scene.getObjectByName('Tail5');
function at(name, time, vertices = false) {
  const mixer = pose(gltf, gltf.animations.find(c => c.name === name), time);
  const v = new THREE.Vector3();
  const result = {
    feet: feet.map(b => b.getWorldPosition(new THREE.Vector3())),
    head: head.getWorldQuaternion(new THREE.Quaternion()),
    tail: tail.getWorldPosition(new THREE.Vector3()),
    vertices: vertices ? meshes.flatMap(m => {
      const points = [];
      for (let i = 0; i < m.geometry.attributes.position.count; i++) {
        m.getVertexPosition(i, v); m.localToWorld(v); points.push(v.clone());
      }
      return points;
    }) : [],
  };
  mixer.stopAllAction(); mixer.uncacheRoot(gltf.scene);
  return result;
}
const seconds = gltf.animations.find(c => c.name === 'Happy').duration;
assert.ok(Math.abs(seconds - 1.6) < 1e-6);
const start = at('Happy', 0, true), end = at('Happy', seconds, true);
// Avoid spreading the complete vertex array into a call on dense models.
const maxSeam = (a, b) => a.vertices.reduce((max, v, i) => Math.max(max, v.distanceTo(b.vertices[i])), 0);
const entrySeam = maxSeam(start, at('Pet', 1.6, true));
const exitSeam = maxSeam(end, at('Idle_Loop', 0, true));
assert.ok(entrySeam < 1e-5 && exitSeam < 1e-5, `pet/happy/idle mesh seam: entry=${entrySeam}, exit=${exitSeam}`);
let footDrift = 0, headAngle = 0, tailLift = 0;
for (let i = 0; i <= 768; i++) {
  const p = at('Happy', i / 480);
  for (let j = 0; j < feet.length; j++) footDrift = Math.max(footDrift, p.feet[j].distanceTo(start.feet[j]));
  headAngle = Math.max(headAngle, p.head.angleTo(start.head));
  tailLift = Math.max(tailLift, p.tail.y - start.tail.y);
}
assert.ok(footDrift < 1e-6, 'four paws remain planted');
assert.ok(headAngle > .20 && headAngle < .5, 'visible, restrained head tilt');
assert.ok(tailLift > .045, 'tail visibly lifts');
const report = { revision, sha256: createHash('sha256').update(await readFile(file)).digest('hex'),
  seconds, sampleHz: 480, samples: 769, entrySeam, exitSeam, footDrift,
  maximumHeadRotationDegrees: THREE.MathUtils.radToDeg(headAngle), maximumTailLiftMetres: tailLift };
await mkdir(`${base}/qa/rig-${revision}`, { recursive: true });
await writeFile(`${base}/qa/rig-${revision}/happy-contact.json`, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
