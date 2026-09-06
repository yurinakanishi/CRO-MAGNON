import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { fitSourceRiverBank } from '../src/source-surface-fit.js';
import { riverBankDrop, riverX } from '../shared/terrain.mjs';

test('a source triangle spanning both banks still exposes the lowered riverbed', () => {
  const source = new THREE.BufferGeometry();
  source.setAttribute('position', new THREE.Float32BufferAttribute([55,0,40, 75,0,40, 75,0,60, 55,0,60], 3));
  source.setAttribute('uv', new THREE.Float32BufferAttribute([0,0, 1,0, 1,1, 0,1], 2));
  source.setIndex([0,2,1, 0,3,2]);
  const fitted = fitSourceRiverBank(source), material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(fitted, material), ray = new THREE.Raycaster();
  for (const z of [42,47,53,58]) for (const offset of [-4,-2,0,2,4]) {
    const x = riverX(z) + offset;
    ray.set(new THREE.Vector3(x,2,z), new THREE.Vector3(0,-1,0));
    const hits = ray.intersectObject(mesh);
    assert.ok(hits.length, 'the source surface must remain continuous');
    assert.ok(Math.abs(hits[0].point.y + riverBankDrop(x,z)) < .045, 'visible ground must follow the bank height');
  }
  const p = fitted.attributes.position, uv = fitted.attributes.uv;
  for(let i=0;i<p.count;i++) {
    assert.ok(Math.abs(uv.getX(i) - (p.getX(i)-55)/20) < .00001);
    assert.ok(Math.abs(uv.getY(i) - (p.getZ(i)-40)/20) < .00001);
  }
  source.dispose(); fitted.dispose(); material.dispose();
});
