import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {regionFeatureDiagnostics} from '../dist/src/region-feature-diagnostics.js';

test('regional feature diagnostics verify real sharing and expose accidental copies',()=>{
  const geometry=new THREE.BufferGeometry(),texture=new THREE.Texture(),material=new THREE.MeshStandardMaterial({map:texture});
  const scene=new THREE.Group();scene.add(new THREE.Mesh(geometry,material));
  const key='desert-cactus',assets={templates:new Map([[key,{gltf:{scene},lods:[]}]])},keys=new Set([key]);
  const instances=new Map(Array.from({length:48},(_,i)=>{const root=scene.clone(true);root.userData.regionFeature=key;return [i,root];}));
  const result=regionFeatureDiagnostics(assets,instances,keys);
  assert.equal(result.counts[key],48);assert.equal(result.sourceGeometries,1);assert.equal(result.sourceTextures,1);
  assert.equal(result.extraGeometries+result.extraMaterials+result.extraTextures,0);
  const bad=instances.get(7).children[0];bad.geometry=geometry.clone();bad.material=material.clone();bad.material.map=texture.clone();
  const broken=regionFeatureDiagnostics(assets,instances,keys);
  assert.equal(broken.extraGeometries,1);assert.equal(broken.extraTextures,1);assert.equal(broken.extraMaterials,1);
});
