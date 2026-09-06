import test from 'node:test';
import assert from 'node:assert/strict';
import { WORLD, worldClamp } from '../shared/world.mjs';
import { BIOMES, biomeAt, biomeWeights, nearbyChunks, JOURNEY_STOPS } from '../shared/biomes.mjs';
import { CollisionWorld } from '../shared/collision.mjs';
import { movePlayer } from '../shared/movement.mjs';
import { projectileWallEntry } from '../shared/combat.mjs';
import { installBiomeTerrain, terrainHeight } from '../shared/terrain.mjs';
import { PlacementGrid } from '../shared/spatial-grid.mjs';
import { SCENERY, grassForChunk } from '../shared/scenery-layout.mjs';

test('five distinct regions share one continuous bounded world and normalized transitions',()=>{
  assert.equal(WORLD.maxX-WORLD.minX,640);assert.equal(WORLD.maxZ-WORLD.minZ,640);
  for(const b of BIOMES)assert.equal(biomeAt(b.x,b.z).id,b.id);
  for(let x=-250;x<380;x+=11)for(let z=-250;z<380;z+=13) {
    const w=biomeWeights(x,z);assert.ok(w.every(n=>n>=0&&Number.isFinite(n)));
    assert.ok(Math.abs(w.reduce((a,b)=>a+b,0)-1)<1e-12);
    const next=biomeWeights(x+.001,z);assert.ok(w.every((n,i)=>Math.abs(n-next[i])<.001));
  }
});
test('moving the camera across the complete world keeps the chunk working set bounded',()=>{
  const explored=new Set();let max=0;
  for(let x=-252;x<380;x+=16)for(let z=-252;z<380;z+=16) {
    const chunks=nearbyChunks(x,z,128);max=Math.max(max,chunks.length);
    assert.equal(new Set(chunks.map(c=>c.key)).size,chunks.length);
    assert.ok(chunks.every(c=>c.ix>=0&&c.ix<20&&c.iz>=0&&c.iz<20));
    for(const c of chunks)explored.add(c.key);
  }
  assert.equal(explored.size,400);assert.ok(max<=70,`Resident chunks grew to ${max}`);
});
test('negative coordinates, the former valley border, and actual outer borders agree for movement and magic',()=>{
  const collision=new CollisionWorld([],{river:false}),p={x:-120,z:180,dx:1,dz:0,lastInput:100,runningRequested:true,species:'cat'};
  movePlayer(p,1,100,(a,dx,dz)=>collision.move(a,dx,dz,.32));assert.ok(p.x>-120&&p.x<-116);
  assert.equal(collision.free({x:110,z:110},.32),true);
  assert.equal(collision.free({x:WORLD.minX-1,z:110},.32),false);
  assert.equal(worldClamp(-999,'x'),WORLD.minX+2);
  assert.equal(projectileWallEntry(collision,{x:96,z:110},{x:105,z:110},.1),Infinity);
  const hit=projectileWallEntry(collision,{x:380,z:110},{x:390,z:110},.1);assert.equal(hit,.2);
});
test('every regional route is physically walkable in both directions, including a five-person camp',()=>{
  const collision=new CollisionWorld(),start={x:49,z:57},crowd=[{type:'circle',x:50,z:57,radius:.32},{type:'circle',x:48,z:57,radius:.32},{type:'circle',x:49,z:56,radius:.32},{type:'circle',x:50.5,z:58,radius:.32}];
  for(const goal of JOURNEY_STOPS)for(const reverse of [false,true]) {
    const from=reverse?goal:start,to=reverse?start:goal,path=collision.path(from,to,.32,crowd);
    assert.ok(path.length,`${goal.id} ${reverse?'return':'outward'} is blocked`);
    let previous=from;for(const point of path){assert.ok(collision.segmentFree(previous,point,.32,crowd));previous=point;}
    assert.ok(Math.hypot(previous.x-to.x,previous.z-to.z)<.01);
  }
});
test('biome terrain requires measured source fields and keeps the common tile joints continuous',()=>{
  assert.throws(()=>installBiomeTerrain({}),/verified terrain/);
  const fields=Object.fromEntries(BIOMES.map((b,i)=>[b.id,{resolution:3,heights:[0,0,0,0,.1+i*.01,0,0,0,0]}]));
  const release=installBiomeTerrain(fields);
  for(let x=-224;x<380;x+=32)for(let z=-230;z<380;z+=23)if(x<50||x>80)assert.ok(Math.abs(terrainHeight(x-.0001,z)-terrainHeight(x+.0001,z))<.001);
  release();assert.equal(terrainHeight(-120,-110),0);
});
test('spatial placement queries include every nearby tree without scanning the full forest',()=>{
  const grid=new PlacementGrid(SCENERY.trees),radius=40,capacity=grid.maximumNearby(radius);
  for(const stop of JOURNEY_STOPS) {
    const near=[...grid.near(stop.x,stop.z,radius)],expected=SCENERY.trees.filter(p=>Math.hypot(p.x-stop.x,p.z-stop.z)<=radius);
    assert.ok(expected.every(p=>near.includes(p)));assert.ok(near.length<=capacity);assert.ok(near.length<SCENERY.trees.length/3);
  }
  assert.deepEqual(grassForChunk(6,6),grassForChunk(6,6));assert.ok(grassForChunk(0,0).length<=250);
});
