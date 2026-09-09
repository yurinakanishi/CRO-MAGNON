import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import * as THREE from 'three';
import { WebSocket } from 'ws';
import { createGameServer } from '../server.mjs';
import { CollisionWorld } from '../dist/shared/collision.mjs';
import { interactionVisible } from '../dist/shared/interactions.mjs';
import { handleHuntingAction } from '../dist/shared/hunting.mjs';
import { acceptsGameShortcut, movementKey } from '../dist/src/combat-input.js';
import { selectedHuntTarget, attackReady, huntInteraction } from '../dist/src/hunting-ui.js';
import { sha256 } from '../dist/src/asset-hash.js';
import { OpenWorldTerrain } from '../dist/src/open-world.js';
import { NPC } from '../dist/shared/world.mjs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate) {
  for (let i=0;i<300;i++) { if(predicate())return; await sleep(10); }
  assert.fail('Expected authoritative state did not arrive');
}
async function session(t) {
  const game=createGameServer({port:0,host:'127.0.0.1',tickMs:20});await game.listen();
  const socket=new WebSocket(`ws://127.0.0.1:${game.address().port}/ws?room=AUDIT`),messages=[];
  socket.on('message',bytes=>messages.push(JSON.parse(bytes)));
  t.after(async()=>{socket.terminate();await game.close();});
  await until(()=>messages.some(m=>m.type==='welcome'));
  const room=game.rooms.get('AUDIT'),player=room.players.values().next().value;
  const send = message => socket.send(JSON.stringify(message));
  const action = async name => {
    player.lastAction=0;const index=messages.length;send({type:'action',action:name});
    await until(()=>messages.slice(index).some(m=>m.type==='notice'));
    return messages.slice(index).find(m=>m.type==='notice');
  };
  return {game,socket,room,player,messages,send,action};
}

test('modified shortcuts do not perform game actions and physical movement survives layout changes',()=>{
  for(const key of ['w','e','h','1','r'])for(const modifier of ['ctrlKey','altKey','metaKey'])assert.equal(acceptsGameShortcut({key,[modifier]:true}),false);
  assert.equal(acceptsGameShortcut({key:'w',shiftKey:true}),true);
  assert.equal(acceptsGameShortcut({isComposing:true}),false);
  assert.equal(movementKey({code:'KeyW',key:'て'}),'w');
  assert.equal(movementKey({code:'KeyW',key:'W'}),'w');
  assert.equal(movementKey({code:'KeyA',key:'ф'}),'a');
});

test('occupied mammoths and mounted or downed players do not expose hunting actions',()=>{
  const player={x:10,z:10,radius:.32,inventory:{rawMeat:1}};
  const occupied={id:'occupied',x:11,z:10,phase:'alive',radius:2,riderId:'peer'};
  const available={...occupied,id:'available',x:20,riderId:null};
  assert.equal(selectedHuntTarget([occupied,available],player,'occupied').id,'available');
  assert.equal(selectedHuntTarget([occupied],player),null);
  assert.equal(attackReady(player,occupied),false);
  assert.equal(attackReady({...player,mountId:'m'},available),false);
  assert.equal(huntInteraction({camp:player,animals:[]},{...player,mountId:'m'}),null);
});

test('nearby attacks work for katana, spear and magic without moving the player', () => {
  const animal = { id: 'm', x: 10, z: 10, radius: 2.94, phase: 'alive' };
  for (const species of ['cro', 'nea', 'cat', 'bear']) {
    const player = { species, x: 10, z: 20, radius: 0.32 },
      point = { x: 10, z: animal.z + animal.radius + 0.32 + 0.4 };
    assert.equal(attackReady({ ...player, ...point }, animal), true, species);
    assert.ok(Math.hypot(point.x - animal.x, point.z - animal.z) > animal.radius + player.radius);
  }
});

test('a free kill keeps the nearby corpse and meat selected instead of a distant living mammoth',()=>{
  const player={x:10,z:10},near={id:'kill',x:12,z:10},far={id:'far',phase:'alive',x:80,z:80};
  for(const phase of ['dying','meat'])assert.equal(selectedHuntTarget([{...near,phase},far],player).id,'kill');
});

test('LAN hashes match native SHA-256 across padding boundaries, slices and large assets',async()=>{
  for(const size of [0,1,55,56,63,64,65,119,120,127,128,1024,262209]){
    const backing=randomBytes(size+13),bytes=backing.subarray(7,7+size),expected=createHash('sha256').update(bytes).digest('hex');
    assert.equal(await sha256(bytes,null),expected,`LAN path length ${size}`);
    assert.equal(await sha256(bytes),expected,`WebCrypto path length ${size}`);
  }
});

test('interaction lines allow the target model but reject intervening walls',()=>{
  const target={id:'wood',x:12,z:10},player={x:8,z:10};
  const own={type:'box',x:12,z:10,hx:.5,hz:.5,c:1,s:0,resourceId:'wood'};
  assert.equal(interactionVisible(new CollisionWorld([own]),player,target),true);
  const wall={type:'box',x:10,z:10,hx:.3,hz:3,c:1,s:0};
  assert.equal(interactionVisible(new CollisionWorld([own,wall]),player,target),false);
});

test('the NPC map arrival is body-clear and on the accessible side of the bridge rail',()=>{
  const collision=new CollisionWorld(),arrival={x:NPC.x,z:NPC.z-2};
  assert.equal(collision.free(arrival,.32),true);
  assert.equal(interactionVisible(collision,arrival,NPC),true);
  assert.ok(collision.path({x:49,z:52.4},arrival,.32).length);
});

test('gathering cannot cross a wall, skips full item types and tracks only collected resources',async t=>{
  const {room,player,action,game}=await session(t);
  Object.assign(player,{x:10,z:10});
  room.resources=[{id:'wood',type:'wood',x:12,z:10,amount:6,maxAmount:6,regeneratedAt:Date.now()},
    {id:'berry',type:'berry',x:10,z:13,amount:5,maxAmount:5,regeneratedAt:Date.now()}];
  room.collision=new CollisionWorld([{type:'box',x:11,z:10,hx:.2,hz:.8,c:1,s:0}]);
  await action('gather');assert.equal(player.inventory.wood,0);assert.equal(player.inventory.berry,1);assert.equal(player.gathered,1);
  room.collision=new CollisionWorld([]);player.inventory.wood=99;
  await action('gather');assert.equal(player.inventory.wood,99);assert.equal(player.inventory.berry,2);assert.equal(player.gathered,2);
  Object.assign(player,{x:70,z:41});await action('trade');assert.equal(player.inventory.berry,5);assert.equal(player.gathered,2);
  assert.equal(game.snapshot(room).players[0].gathered,2);
});

test('cooking cannot overlap attack windup or other inventory actions',async t=>{
  const {room,player,action}=await session(t);
  room.collision=new CollisionWorld([]);Object.assign(player,{x:50,z:52});
  Object.assign(player.inventory,{wood:5,stone:4,rawMeat:2});
  await action('attack');const raw=player.inventory.rawMeat;
  await action('cook');assert.equal(player.cookingEndsAt,0);assert.equal(player.inventory.rawMeat,raw);
  await action('craft');assert.equal(player.tool,false);
  player.attackAt=0;await action('cook');assert.ok(player.cookingEndsAt>Date.now());
  await action('craft');assert.equal(player.tool,false);assert.equal(player.inventory.wood,5);
  await action('cancelCook');assert.equal(player.cookingEndsAt,0);assert.equal(player.inventory.rawMeat,2);
  await action('craft');assert.equal(player.tool,true);
});

test('a slow peer receives a complete resource snapshot after congestion clears',async t=>{
  const {room,player,messages,send}=await session(t);
  let congested=true;
  Object.defineProperty(player.socket,'bufferedAmount',{configurable:true,get:()=>congested?600*1024:0});
  t.after(()=>delete player.socket.bufferedAmount);
  await until(()=>player.needsWorld);
  room.resources[0].amount=0;
  const index=messages.length;congested=false;send({type:'ping',at:123});
  await until(()=>messages.slice(index).some(m=>m.type==='state'&&m.resources));
  const recovered=messages.slice(index).find(m=>m.type==='state'&&m.resources);
  assert.equal(recovered.resources[0].amount,0);assert.equal(player.needsWorld,false);
  const next=messages.length;
  await until(()=>messages.slice(next).some(m=>m.type==='state'));
  assert.equal(messages.slice(next).find(m=>m.type==='state').resources,undefined);
});

test('cooking requires a clear path to the chosen fire',()=>{
  const player={x:10,z:10,inventory:{rawMeat:1,cookedMeat:0}},fire={x:12,z:10};
  const room={cookingFires:[fire],collision:new CollisionWorld([{type:'box',x:11,z:10,hx:.2,hz:2,c:1,s:0}])};
  assert.equal(handleHuntingAction(room,player,{action:'cook'},1000).changed,false);
  assert.equal(player.cookingEndsAt,undefined);assert.equal(player.inventory.rawMeat,1);
});

test('ground remains clickable after existing terrain batches stream to another position',()=>{
  const scene=new THREE.Scene(),world={scene,worldAssets:{},canvas:{dataset:{}}},terrain=new OpenWorldTerrain(world);
  const mesh=new THREE.InstancedMesh(new THREE.PlaneGeometry(32,32).rotateX(-Math.PI/2),new THREE.MeshBasicMaterial(),100);
  mesh.frustumCulled=false;terrain.root.add(mesh);terrain.prepared.set('ground',[[{mesh}]]);terrain.nextPlan=Infinity;
  const camera=new THREE.PerspectiveCamera(60,1,.1,1000),ray=new THREE.Raycaster();
  function sample(x,time){
    terrain.chunks.clear();terrain.chunks.set('test',{x,z:0,yaw:0,assetKey:'ground',bankMeshes:[]});
    camera.position.set(x,20,0);camera.lookAt(x,0,0);camera.updateMatrixWorld(true);
    terrain.update(camera,time);scene.updateMatrixWorld(true);ray.set(new THREE.Vector3(x,20,0),new THREE.Vector3(0,-1,0));
    return ray.intersectObject(terrain.root,true);
  }
  assert.ok(sample(0,1).length);assert.ok(sample(128,2).length,'The first click must not freeze the bounding sphere at the old chunk');
  mesh.dispose();mesh.geometry.dispose();mesh.material.dispose();
});
