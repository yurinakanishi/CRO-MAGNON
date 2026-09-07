import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {CASTLE,CASTLE_GATE,CASTLE_HALL,castleWorld,nearCastle} from '../shared/castle-layout.mjs';
import {CASTLE_SURFACE} from '../shared/castle-surface.mjs';
import {CollisionWorld} from '../shared/collision.mjs';
import {SCENERY,HUNTING_GROUNDS} from '../shared/scenery-layout.mjs';
import {INITIAL_RESOURCES,CAMP} from '../shared/world.mjs';
import {isLand} from '../shared/paleo-geography.mjs';
import {movePlayer} from '../shared/movement.mjs';
import {planNavigation,updateNavigation} from '../shared/navigation.mjs';
import {createEnemies} from '../shared/enemies.mjs';
import {MeshRayGrid} from '../src/mesh-ray-grid.js';
import * as THREE from 'three';
import {geometryScene} from '../scripts/measure-collision-bounds.mjs';

test('castle floor atlas is measured from the delivered mesh and clears the starting valley',async()=>{
  const bytes=await readFile('public/models/valley-castle/model.glb');assert.equal(createHash('sha256').update(bytes).digest('hex'),CASTLE_SURFACE.data.sourceSha256);
  for(let x=-35;x<=35;x+=2)for(let z=-33;z<=33;z+=2){const p=castleWorld(x,z);assert.ok(isLand(p.x,p.z,1));}
  for(const p of [CAMP,...INITIAL_RESOURCES,...HUNTING_GROUNDS,...Object.values(SCENERY).flat()])assert.equal(nearCastle(p.x,p.z),false);
  assert.ok(Math.hypot(CASTLE.x-CAMP.x,CASTLE.z-CAMP.z)<110);
});
test('normal authoritative movement enters the castle, climbs all terraces and returns',()=>{
  const collision=new CollisionWorld(),actor={id:'walker',species:'cat',x:48,z:57,radius:.32,lastInput:0,dx:0,dz:0,runningRequested:true};let now=1000;
  const goals=[CASTLE_GATE,castleWorld(-17,20),castleWorld(-18,12),CASTLE_HALL,castleWorld(18,12),castleWorld(17,20),CASTLE_GATE];
  let maximumHeight=0,samples=0;
  for(const goal of goals){assert.ok(planNavigation(actor,goal,collision,[],now),JSON.stringify(goal));let n=0;
    while(actor.navigationGoal&&n++<5000){now+=50;updateNavigation(actor,collision,[],now);movePlayer(actor,.05,now,(p,dx,dz)=>collision.move(p,dx,dz,p.radius));assert.ok(collision.free(actor,actor.radius));maximumHeight=Math.max(maximumHeight,collision.surfaceHeight(actor));samples++;}
    assert.ok(Math.hypot(actor.x-goal.x,actor.z-goal.z)<.1,`Failed to reach ${JSON.stringify({goal,actor,local:CASTLE_SURFACE.local(actor.x,actor.z)})}`);
  }
  assert.ok(maximumHeight>17.5);assert.ok(samples>500);
  assert.ok(collision.path({x:48,z:57},CASTLE_HALL,.32).length>2,'Long route uses the entrance');
  assert.equal(collision.segmentFree(CASTLE_GATE,CASTLE_HALL,.32),false,'Walls block a straight shortcut');
  const enemy=createEnemies(collision,[],1000)[0];assert.ok(collision.surfaceHeight(enemy)>17.5);
});
test('camera triangle index agrees with full exact-mesh raycasts across the castle',async()=>{
  const gltf=await geometryScene('public/models/valley-castle/model.glb');gltf.scene.position.set(CASTLE.x,0,CASTLE.z);gltf.scene.rotation.y=CASTLE.yaw;gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse(n=>{if(n.isMesh)n.material.side=THREE.DoubleSide;});const grid=new MeshRayGrid(gltf.scene),ray=new THREE.Raycaster();let hits=0;
  for(const local of [[0,30],[-17,20],[-17,12],[0,-12],[7,-12],[0,1]])for(let i=0;i<16;i++){
    const p=castleWorld(...local),origin=new THREE.Vector3(p.x,(CASTLE_SURFACE.height(p.x,p.z)??0)+1.4,p.z),direction=new THREE.Vector3(Math.sin(i*Math.PI/8),.25,Math.cos(i*Math.PI/8)).normalize();
    ray.set(origin,direction);ray.far=9;const hit=ray.intersectObject(gltf.scene,true).find(h=>h.distance>.08);const expected=hit?Math.min(9,Math.max(.35,hit.distance-.2)):9,actual=grid.distance(origin,direction,9);assert.ok(Math.abs(actual-expected)<.002,`${actual} != ${expected}`);if(hit)hits++;
  }assert.ok(hits>20);
});
