// Read-only pose calibration against the delivered character rigs; no game or save is changed.
import * as THREE from 'three';
import ts from 'typescript';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { CHARACTER_MODELS } from '../dist/shared/characters.mjs';
import { loadMotion } from './motion-glb.mjs';
import { deliveredModel } from '../tests/delivered-model.mjs';
import { OctopusPettingPose } from '../dist/src/octopus-pose.js';
const source = (await readFile('src/ground-petting-pose.ts', 'utf8'))
  .replaceAll(
    "'./petting-pose.js'",
    JSON.stringify(pathToFileURL(path.resolve('dist/src/petting-pose.js')).href),
  )
  .replaceAll(
    "'../shared/rimo-neko.mjs'",
    JSON.stringify(pathToFileURL(path.resolve('dist/shared/rimo-neko.mjs')).href),
  )
  .replaceAll(
    "'three'",
    JSON.stringify(pathToFileURL(path.resolve('node_modules/three/build/three.module.js')).href),
  );
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const { GroundPettingPose } = await import(
  'data:text/javascript;base64,' + Buffer.from(compiled).toString('base64')
);
for (const c of CHARACTER_MODELS) {
  const gltf = await loadMotion(await deliveredModel(c.key));
  const pose =
    c.bodyPlan === 'octopus'
      ? new OctopusPettingPose(gltf.scene)
      : new GroundPettingPose(gltf.scene);
  const mixer = new THREE.AnimationMixer(gltf.scene);
  mixer.clipAction(gltf.animations.find((c) => c.name === 'Idle_Loop')).play();
  const trials = [];
  for (let reach = 0.2; reach <= 1.401; reach += 0.05) {
    let gap = 0,
      drift = 0;
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      pose.restore();
      mixer.setTime(t);
      gltf.scene.updateMatrixWorld(true);
      const feet = ['FootL', 'FootR']
        .map((n) => gltf.scene.getObjectByName(n))
        .filter(Boolean)
        .map((b) => [b, b.getWorldPosition(new THREE.Vector3())]);
      pose.update(new THREE.Vector3(c.species === 'ape' ? -0.25 : -0.12, 0.252, reach), 1, t, true);
      gap = Math.max(gap, pose.contact.distanceTo(pose.requested));
      for (const [b, at] of feet)
        drift = Math.max(drift, b.getWorldPosition(new THREE.Vector3()).distanceTo(at));
    }
    trials.push({ reach: Number(reach.toFixed(2)), gap, drift });
  }
  const best = trials.sort((a, b) => a.gap - b.gap)[0];
  console.log(
    JSON.stringify({
      key: c.key,
      best,
      valid: trials.filter((t) => t.gap < 0.04 && t.drift < 0.006).map((t) => t.reach),
    }),
  );
  mixer.stopAllAction();
  mixer.uncacheRoot(gltf.scene);
}
