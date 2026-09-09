import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { ADVENTURE_REGIONS, ADVENTURE_RESOURCES, ADVENTURE_ENEMIES, RIFTS, regionById, adventureProgress, travelSeals } from '../dist/shared/adventure-regions.mjs';
import { ensureAdventure, updateAdventures, handleAdventureAction, recordAdventureGather } from '../dist/shared/adventures.mjs';
import { CollisionWorld, overlap } from '../dist/shared/collision.mjs';
import { isLand } from '../dist/shared/paleo-geography.mjs';
import { createGameCore } from '../dist/shared/game-core.mjs';
import { startAttack, resolveAttack, updateProjectiles } from '../dist/shared/combat.mjs';
import { createEnemies } from '../dist/shared/enemies.mjs';
import { SCENERY } from '../dist/shared/scenery-layout.mjs';
import { AdventureMaterials } from '../dist/src/adventure-materials.js';
import * as THREE from 'three';

const collision=new CollisionWorld();
const makePlayer=(id='p')=>({id,x:48,z:57,radius:.32,species:'cro',energy:100,inventory:{wood:0,stone:0,berry:0,rawMeat:0,cookedMeat:0},path:[],facing:0,adventure:{regions:{}}});
const makeRoom=(players=[])=>({players:new Map(players.map(p=>[p.id,p])),collision,animals:[],enemies:[],projectiles:[],camp:{x:50,z:50},cookingFires:SCENERY.fires});
function complete(p,r){ensureAdventure(p).regions[r.id]={visited:r.checkpoints.map(c=>c.id),gathered:r.amount,kills:r.kills,defeated:ADVENTURE_ENEMIES.filter(e=>e.regionId===r.id).map(e=>e.id),claimed:false};}

test('all six authored routes, resources and rifts stay on land with reachable approaches',()=>{
  for(const r of ADVENTURE_REGIONS){
    let previous=r.camp;
    for(const p of [...r.checkpoints,r.camp]){
      assert.ok(isLand(p.x,p.z),r.id);assert.ok(collision.free(p,.32),JSON.stringify(p));
      const route=collision.path(previous,p,.32);assert.ok(route.length,`${r.id}: missing route`);
      let a=previous;for(const b of route){assert.ok(collision.segmentFree(a,b,.32),`${r.id}: blocked route`);a=b;}previous=p;
    }
  }
  for(const p of [...RIFTS,...ADVENTURE_ENEMIES])assert.ok(collision.free(p,.48),p.id);
  for(const p of ADVENTURE_RESOURCES){
    assert.equal([...collision.nearby(p,.3)].filter(o=>o.resourceId!==p.id&&overlap(p,.3,o)).length,0,p.id);
    const approach=collision.nearestFree({x:p.x-2,z:p.z},.32,[],3);
    assert.ok(approach&&collision.path(regionById(p.regionId).camp,approach,.32).length,p.id);
  }
});
test('discovery and waypoints are server-position based, once only, and blocked by walls',()=>{
  const p=makePlayer(),room=makeRoom([p]),r=ADVENTURE_REGIONS[0],notices=[];
  Object.assign(p,r.checkpoints[0],{id:'p'});updateAdventures(room,1000,(_,m)=>notices.push(m));updateAdventures(room,1100,(_,m)=>notices.push(m));
  assert.deepEqual(p.adventure.regions[r.id].visited,[r.checkpoints[0].id]);assert.equal(notices.length,2);
  Object.assign(p,{x:r.checkpoints[1].x+2,z:r.checkpoints[1].z});
  room.collision={segmentFree:()=>false};updateAdventures(room,1200);assert.equal(p.adventure.regions[r.id].visited.length,1);
});
test('regional collection counts only actual matching local resources and caps at the requirement',()=>{
  const p=makePlayer(),r=ADVENTURE_REGIONS[0],resource=ADVENTURE_RESOURCES.find(x=>x.regionId===r.id&&x.type===r.material);
  recordAdventureGather(p,{type:'stone'},20);assert.equal(Object.keys(p.adventure.regions).length,0);
  recordAdventureGather(p,{...resource,type:'berry'},3);assert.equal(Object.keys(p.adventure.regions).length,0);
  recordAdventureGather(p,resource,2);recordAdventureGather(p,resource,8);assert.equal(adventureProgress(p,r.id).gathered,4);
});
test('claim requires complete goals at that camp, gives atomic rewards and cannot be repeated',()=>{
  const p=makePlayer(),room=makeRoom([p]),r=ADVENTURE_REGIONS[0],msg={action:'claimAdventure',targetId:r.id};
  assert.equal(handleAdventureAction(room,p,msg).ok,false);Object.assign(p,r.camp);
  assert.equal(handleAdventureAction(room,p,msg).ok,false);complete(p,r);p.inventory.wood=98;
  assert.equal(handleAdventureAction(room,p,msg).ok,false);assert.equal(p.inventory.cookedMeat,0);assert.equal(travelSeals(p),0);
  p.inventory.wood=0;assert.equal(handleAdventureAction(room,p,msg).ok,true);assert.equal(p.inventory.cookedMeat,2);assert.equal(travelSeals(p),1);
  const after={...p.inventory};assert.equal(handleAdventureAction(room,p,msg).ok,false);assert.deepEqual(p.inventory,after);
});
test('rifts enforce seals, proximity, cooldown and safe occupancy, preserving inventory and clearing attacks',()=>{
  const p=makePlayer(),room=makeRoom([p]),msg={action:'rift',targetId:RIFTS[0].id};
  Object.assign(p,RIFTS[0],{id:'p'});assert.equal(handleAdventureAction(room,p,msg,10000).ok,false);
  for(const r of ADVENTURE_REGIONS.slice(0,3)){complete(p,r);p.adventure.regions[r.id].claimed=true;}
  p.x+=10;assert.equal(handleAdventureAction(room,p,msg,10000).ok,false);p.x-=10;
  const original={...p.inventory};p.pendingStrike={};p.cookingEndsAt=20000;room.projectiles=[{ownerId:p.id},{ownerId:'other'}];
  assert.equal(handleAdventureAction(room,p,msg,10000).ok,true);assert.deepEqual(p.inventory,original);assert.equal(p.pendingStrike,null);assert.equal(p.cookingEndsAt,0);assert.equal(room.projectiles.length,1);
  assert.equal(handleAdventureAction(room,p,{action:'rift',targetId:RIFTS[1].id},11000).ok,false);
  // Exit stays available even without any seals (including old saved progress).
  p.adventure={regions:{}};assert.equal(handleAdventureAction(room,p,{action:'rift',targetId:RIFTS[1].id},14000).ok,true);
  const before={x:p.x,z:p.z};room.collision={segmentFree:()=>true,nearestFree:()=>null};
  for(const r of ADVENTURE_REGIONS.slice(0,3)){complete(p,r);p.adventure.regions[r.id].claimed=true;}
  assert.equal(handleAdventureAction(room,p,msg,18000).ok,false);assert.deepEqual({x:p.x,z:p.z},before);
});
test('downed and mounted actors cannot enter the rift', () => {
  const p = makePlayer(),
    room = makeRoom([p]);
  for (const key of ['downedUntil', 'mountId', 'boatId']) {
    p[key] = 1;
    assert.equal(
      handleAdventureAction(room, p, { action: 'rift', targetId: RIFTS[0].id }).ok,
      false,
    );
    p[key] = null;
  }
});
test('real lethal attacks share distinct guardian credit with nearby allies, including spell kills',()=>{
  const r=regionById('shadow-realm'),p=makePlayer(),ally=makePlayer('ally'),distant=makePlayer('distant'),room=makeRoom([p,ally,distant]);
  room.enemies=createEnemies(collision).filter(e=>e.regionId===r.id);
  let now=10000;
  for(const e of room.enemies){
    Object.assign(p,{x:e.x,z:e.z-1.5,facing:0,attackSequence:0});Object.assign(ally,{x:e.x+4,z:e.z});
    e.health=1;
    assert.equal(startAttack(room,p,{targetId:e.id},now).accepted,true);
    assert.equal(resolveAttack(room,p,now+334).killed,true);
    updateAdventures(room,now+350);updateAdventures(room,now+400);now+=3000;
  }
  assert.equal(adventureProgress(p,r.id).kills,2);assert.equal(adventureProgress(ally,r.id).kills,2);assert.equal(adventureProgress(distant,r.id).kills,0);
  const e=room.enemies[0];Object.assign(e,{phase:'alive',alive:true,health:1});updateAdventures(room,now);
  Object.assign(p,{species:'bear',attackSequence:0,x:e.x,z:e.z-3,facing:0});startAttack(room,p,{targetId:e.id},now);resolveAttack(room,p,now+401);
  assert.equal(updateProjectiles(room,now+900)[0]?.killed,true);updateAdventures(room,now+910);assert.equal(adventureProgress(p,r.id).kills,2,'same guardian is not double counted');
});
test('rest heals only at local camp and is bounded by threat and cooldown',()=>{
  const p=makePlayer(),r=ADVENTURE_REGIONS[0],room=makeRoom([p]);p.energy=10;Object.assign(p,r.camp);
  assert.equal(handleAdventureAction(room,p,{action:'rest'},10000).ok,true);assert.equal(p.energy,45);
  assert.equal(handleAdventureAction(room,p,{action:'rest'},20000).ok,false);
  room.enemies=[{phase:'alive',x:p.x+5,z:p.z}];assert.equal(handleAdventureAction(room,p,{action:'rest'},35000).ok,false);
  room.enemies=[];p.x+=15;assert.equal(handleAdventureAction(room,p,{action:'rest'},36000).ok,false);
});
class Socket extends EventEmitter{readyState=1;bufferedAmount=0;messages=[];send(data){this.messages.push(JSON.parse(data));}close(){this.readyState=3;this.emit('close');}ping(){}terminate(){this.close();}}
test('reporting a quest then immediately using its return rift is accepted by the real message handler',()=>{
  const core=createGameCore(),socket=new Socket();core.connect(socket,new URLSearchParams({room:'RETURN'}));
  const room=core.rooms.get('RETURN'),p=[...room.players.values()][0],r=regionById('shadow-realm');complete(p,r);Object.assign(p,r.camp);
  const send=message=>socket.emit('message',Buffer.from(JSON.stringify(message)),false);
  send({type:'action',action:'claimAdventure',targetId:r.id});assert.equal(adventureProgress(p,r.id).claimed,true);
  send({type:'action',action:'rift',targetId:'return-rift'});assert.ok(Math.hypot(p.x-RIFTS[0].x,p.z-RIFTS[0].z)<6);
  const after={x:p.x,z:p.z};send({type:'action',action:'rift',targetId:'star-rift'});assert.deepEqual({x:p.x,z:p.z},after);core.close();
});
test('saved worlds and same-session reconnect retain exploration and append new content to older saves',()=>{
  const core=createGameCore(),socket=new Socket();core.connect(socket,new URLSearchParams({room:'SAVE',resume:'1'}));
  const room=core.rooms.get('SAVE'),p=[...room.players.values()][0],r=ADVENTURE_REGIONS[0];complete(p,r);p.adventure.regions[r.id].claimed=true;p.inventory.wood=8;
  const saved=core.exportState(),token=p.sessionToken;socket.close();
  const reconnect=new Socket();core.connect(reconnect,new URLSearchParams({room:'SAVE',resume:'1',session:token}));assert.equal(travelSeals([...room.players.values()][0]),1);
  const restored=createGameCore();restored.importState(saved);const s=new Socket();restored.connect(s,new URLSearchParams({room:'SAVE',resume:'1',session:token}));
  const after=[...restored.rooms.get('SAVE').players.values()][0];assert.deepEqual(after.adventure,p.adventure);assert.equal(after.inventory.wood,8);
  const older=structuredClone(saved);for(const r of older.rooms){r.resources=r.resources.filter(x=>!x.regionId);r.enemies=r.enemies.filter(x=>!x.regionId);for(const entry of r.sessions)delete entry.player.adventure;}
  const migrated=createGameCore();migrated.importState(older);assert.equal(migrated.rooms.get('SAVE').resources.filter(x=>x.regionId).length,18);assert.equal(migrated.rooms.get('SAVE').enemies.filter(x=>x.regionId).length,4);
  core.close();restored.close();migrated.close();
});
test('landmark coatings share actual geometry and textures, and release only their own materials',()=>{
  const source=new THREE.MeshStandardMaterial({map:new THREE.Texture()}),geometry=new THREE.BufferGeometry(),mesh=new THREE.Mesh(geometry,source),root=new THREE.Group();root.add(mesh);
  const owner=new AdventureMaterials(),a=root.clone(true),b=root.clone(true);owner.apply(a,'alpine','volcanic-cone',0);owner.apply(b,'alpine','volcanic-cone',0);
  assert.equal(a.children[0].geometry,geometry);assert.equal(a.children[0].material,b.children[0].material);assert.equal(a.children[0].material.map,source.map);assert.notEqual(a.children[0].material,source);
  let disposed=0;a.children[0].material.addEventListener('dispose',()=>disposed++);owner.evict(13);assert.equal(disposed,1);assert.equal(owner.cache.size,0);
});
