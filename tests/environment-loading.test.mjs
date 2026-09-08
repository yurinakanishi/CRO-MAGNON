import test from 'node:test';
import { CollisionWorld } from '../dist/shared/collision.mjs';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WorldAssets } from '../dist/src/world-assets.js';
import { nearestCookingFire,handleHuntingAction,updateHunting } from '../dist/shared/hunting.mjs';
import { SCENERY } from '../dist/shared/scenery-layout.mjs';

const record=key=>({modelKey:key,environment:true,onDemand:true,lods:[],url:key});
const fixture=()=>{const scene=new THREE.Group(),geometry=new THREE.BufferGeometry(),material=new THREE.MeshStandardMaterial();scene.add(new THREE.Mesh(geometry,material));return{scene,geometry,material};};
test('regional loads coalesce, never exceed two active decodes, and release geometry on eviction',async()=>{
  const pending=[],started=[];let disposed=0;
  const assets=new WorldAssets({loadEnvironment:asset=>new Promise(resolve=>{started.push(asset.modelKey);pending.push(()=>{const model=fixture();model.geometry.addEventListener('dispose',()=>disposed++);resolve(model);});})});
  assets.catalog={assets:['a','b','c'].map(record)};
  const a=assets.ensureEnvironment('a'),b=assets.ensureEnvironment('b'),c=assets.ensureEnvironment('c');
  assert.equal(assets.ensureEnvironment('a'),a);assert.deepEqual(started,['a','b']);
  pending.shift()();await a;assert.deepEqual(started,['a','b','c']);
  pending.shift()();pending.shift()();await Promise.all([b,c]);
  assert.equal(assets.templates.size,3);assets.releaseEnvironment('a');assert.equal(disposed,1);assert.equal(assets.templates.size,2);
  assets.dispose();assert.equal(disposed,3);
});
test('closing during a regional download rejects queued work and disposes late meshes without resurrection',async()=>{
  const pending=[];let disposed=0,calls=0;
  const assets=new WorldAssets({loadEnvironment:()=>new Promise(resolve=>{calls++;pending.push(()=>{const model=fixture();model.geometry.addEventListener('dispose',()=>disposed++);resolve(model);});})});
  assets.catalog={assets:['a','b','c'].map(record)};
  const promises=['a','b','c'].map(k=>assets.ensureEnvironment(k));const settled=Promise.allSettled(promises);
  assets.dispose();for(const finish of pending)finish();
  const results=await settled;assert.ok(results.every(r=>r.status==='rejected'));assert.equal(calls,2);assert.equal(disposed,2);assert.equal(assets.templates.size,0);
  await assert.rejects(assets.ensureEnvironment('a'),/disposed/);
});
test('a failed region cannot substitute another asset or leave its partial LOD resident',async()=>{
  let count=0,disposed=0;
  const assets=new WorldAssets({loadEnvironment:async()=>{if(count++)throw new Error('integrity mismatch');const model=fixture();model.geometry.addEventListener('dispose',()=>disposed++);return model;}});
  assets.catalog={assets:[{...record('snow'),lods:[{url:'snow-lod'}]}]};
  await assert.rejects(assets.ensureEnvironment('snow'),/integrity mismatch/);assert.equal(disposed,1);assert.equal(assets.templates.size,0);
  await assert.rejects(assets.ensureEnvironment('unknown'),/Missing verified environment/);
});
test('a region camp cooks real inventory and leaving its fire cancels without consuming raw meat',()=>{
  const fire=SCENERY.fires.find(f=>f.id==='fire-snow'),p={id:'p',x:fire.x,z:fire.z+2,inventory:{rawMeat:2,cookedMeat:0},energy:60,path:[],radius:.32};
  const room={collision:new CollisionWorld(),camp:{x:50,z:50},cookingFires:SCENERY.fires,players:new Map([['p',p]]),animals:[]};
  assert.equal(nearestCookingFire(room,p),fire);handleHuntingAction(room,p,{action:'cook'},1000);assert.equal(p.cookingEndsAt,4000);assert.equal(p.inventory.rawMeat,2);
  updateHunting(room,4100);assert.equal(p.inventory.rawMeat,1);assert.equal(p.inventory.cookedMeat,1);
  handleHuntingAction(room,p,{action:'cook'},5000);p.z+=10;updateHunting(room,8200);
  assert.equal(p.cookingEndsAt,0);assert.equal(p.inventory.rawMeat,1);assert.equal(p.inventory.cookedMeat,1);
});
