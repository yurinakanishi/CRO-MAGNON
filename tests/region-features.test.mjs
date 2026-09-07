import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as THREE from 'three';
import {REGION_FEATURES} from '../shared/region-features.mjs';
import {REGION_FEATURE_BOUNDS} from '../shared/region-feature-bounds.mjs';
import {CollisionWorld,staticObstacles} from '../shared/collision.mjs';
import {biomeAt,roadDistance,JOURNEY_STOPS} from '../shared/biomes.mjs';
import {WorldAssets} from '../src/world-assets.js';
import {WorldLandmarks} from '../src/world-landmarks.js';

test('new regional shapes match delivered GLBs and leave original scenery and roads clear',async()=>{
  const keys=new Set(REGION_FEATURES.map(p=>p.key)),base=new CollisionWorld(staticObstacles().filter(o=>!keys.has(o.modelKey)));
  assert.equal(REGION_FEATURES.length,66);assert.equal(new Set(REGION_FEATURES.map(p=>p.id)).size,66);
  for(const key of keys){
    const manifest=JSON.parse(await readFile(new URL(`../public/models/${key}/asset.json`,import.meta.url),'utf8'));
    assert.equal(REGION_FEATURE_BOUNDS[key].sha256,manifest.sha256);
    assert.equal(REGION_FEATURE_BOUNDS[key].verification.misses,0);
    assert.ok(manifest.onDemand&&manifest.environment);assert.deepEqual(manifest.clips,[]);
  }
  for(const p of REGION_FEATURES){
    assert.equal(biomeAt(p.x,p.z).id,p.biome);assert.ok(roadDistance(p.x,p.z)>=p.clearance+5);
    assert.ok(base.free(p,p.clearance+1.39),`${p.id} overlaps previous scenery`);
    assert.ok(JOURNEY_STOPS.every(stop=>Math.hypot(p.x-stop.x,p.z-stop.z)>=p.clearance+9));
  }
});

test('body movement cannot cross a rotated and scaled regional model footprint',()=>{
  const all=staticObstacles(),collision=new CollisionWorld(all);
  for(const p of REGION_FEATURES){
    const boxes=all.filter(o=>o.landmarkId===p.id),target=boxes.reduce((a,b)=>Math.hypot(a.x-p.x,a.z-p.z)<Math.hypot(b.x-p.x,b.z-p.z)?a:b);
    assert.ok(!collision.free(target,.32));
    for(const angle of [0,Math.PI/2,Math.PI,Math.PI*1.5]){
      let point=collision.nearestFree({x:p.x+Math.cos(angle)*(p.clearance+2),z:p.z+Math.sin(angle)*(p.clearance+2)},.32);
      assert.ok(point);
      for(let i=0;i<50;i++){
        const distance=Math.hypot(target.x-point.x,target.z-point.z),step=Math.min(.3,distance);
        point=collision.move(point,(target.x-point.x)/distance*step,(target.z-point.z)/distance*step,.32);
        assert.ok(collision.free(point,.32),`${p.id} allowed penetration`);
      }
      assert.ok(Math.hypot(point.x-target.x,point.z-target.z)>.3);
    }
  }
});

test('landmark streaming shares six copies, bounds creation, evicts and reloads a regional model',async()=>{
  let loads=0,disposedGeometry=0;
  const assets=new WorldAssets({loadEnvironment:async()=>{
    loads++;const geometry=new THREE.BufferGeometry();geometry.addEventListener('dispose',()=>disposedGeometry++);
    geometry.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,1,0,0,0,1,0],3));
    const map=new THREE.Texture();map.userData.embeddedSha256='same-embedded-test-image';
    const scene=new THREE.Group();scene.add(new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({map})));return {scene};
  }});
  assets.catalog={assets:[{modelKey:'desert-cactus',environment:true,onDemand:true,lods:[{url:'verified-lod'}]}]};
  const world={worldAssets:assets,scene:new THREE.Scene(),canvas:{dataset:{}},updateAssetDiagnostics(){},failWorld(message,error){throw error??Error(message);}};
  const placements=Array.from({length:6},(_,i)=>({id:`test-${i}`,key:'desert-cactus',x:i*2,z:0,yaw:i*.3,scale:1,clearance:1,groundOffset:-.04}));
  const manager=new WorldLandmarks(world,placements),camera=new THREE.PerspectiveCamera();camera.position.set(0,2,8);camera.updateMatrixWorld(true);
  manager.update(camera,0);await Promise.all(manager.pending.values());manager.update(camera,.4);
  assert.equal(manager.instances.size,4);manager.update(camera,.8);assert.equal(manager.instances.size,6);assert.equal(loads,2);
  const diagnostic=manager.diagnostics();assert.equal(diagnostic.counts['desert-cactus'],6);assert.equal(diagnostic.sourceTextures,1);
  assert.equal(diagnostic.extraGeometries+diagnostic.extraMaterials+diagnostic.extraTextures,0);
  camera.position.set(1000,2,1000);camera.updateMatrixWorld(true);manager.update(camera,2);
  assert.equal(manager.instances.size,0);assert.ok(assets.templates.has('desert-cactus'));assert.equal(disposedGeometry,0);
  manager.update(camera,14);assert.ok(!assets.templates.has('desert-cactus'));assert.equal(disposedGeometry,2);
  camera.position.set(0,2,8);camera.updateMatrixWorld(true);manager.update(camera,15);await Promise.all(manager.pending.values());manager.update(camera,15.4);
  assert.equal(loads,4);assert.equal(manager.instances.size,4);assert.equal(manager.diagnostics().extraGeometries,0);
  manager.dispose();assets.dispose();
});
