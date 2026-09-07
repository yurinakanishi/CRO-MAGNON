import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import {createGameServer} from '../server.mjs';
import {createRestoringServer} from '../output/open-world-restart/run.mjs';

async function join(game,name,species,expected=()=>true){
  return new Promise((resolve,reject)=>{
    const socket=new WebSocket(`ws://127.0.0.1:${game.address().port}/ws?${new URLSearchParams({room:'FANTASY-QA',name,species,gender:'female'})}`);
    const timer=setTimeout(()=>{socket.terminate();reject(new Error('Restore snapshot timed out'));},3000);socket.on('error',reject);
    socket.on('message',bytes=>{const state=JSON.parse(bytes);if(state.type==='state'&&expected(state)){clearTimeout(timer);resolve({socket,state});}});
  });
}

test('world rollout restores cat/bear inventories, resources and hunting phases using the current full protocol',async t=>{
  const original=createGameServer({port:0,host:'127.0.0.1',tickMs:100000});await original.listen();
  await join(original,'旅人猫','cat');await join(original,'旅人熊','bear');
  const room=original.rooms.get('FANTASY-QA'),players=[...room.players.values()];
  Object.assign(players[0],{x:-115,z:-96,tool:true,gathered:7,energy:63,inventory:{wood:12,stone:9,berry:4,rawMeat:2,cookedMeat:3}});
  Object.assign(players[1],{x:207,z:-107,inventory:{wood:3,stone:8,berry:2,rawMeat:1,cookedMeat:4}});
  room.resources[0].amount=1;room.camp.wood=8;room.camp.stone=4;
  Object.assign(room.animals[0],{phase:'meat',health:0,meatRemaining:3});
  Object.assign(room.enemies[0],{phase:'respawning',health:0,alive:false,phaseStartedAt:Date.now()});
  const checkpoint={schemaVersion:2,purpose:'open-world-rollout',port:3000,room:'FANTASY-QA',capturedAt:new Date().toISOString(),snapshot:original.snapshot(room,true)};
  await original.close();
  const restored=createRestoringServer({checkpoint,port:0,host:'127.0.0.1',tickMs:100000});await restored.listen();t.after(()=>restored.close());
  const cat=await join(restored,'旅人猫','cat',s=>s.players.some(p=>p.name==='旅人猫'&&p.inventory.rawMeat===2));
  const bear=await join(restored,'旅人熊','bear',s=>s.players.some(p=>p.name==='旅人熊'&&p.inventory.cookedMeat===4));
  for(const before of checkpoint.snapshot.players){const after=bear.state.players.find(p=>p.name===before.name);assert.deepEqual(after.inventory,before.inventory);assert.equal(after.x,before.x);assert.equal(after.z,before.z);assert.equal(after.species,before.species);}
  assert.equal(cat.state.worldVersion,3);assert.equal(cat.state.combatVersion,3);assert.equal(cat.state.characterVersion,2);
  assert.equal(cat.state.players.find(p=>p.name==='旅人猫').gathered,7);
  assert.equal(cat.state.cookingFires.length,14);assert.deepEqual(cat.state.projectiles,[]);
  assert.equal(cat.state.animals[0].phase,'meat');assert.equal(cat.state.animals[0].meatRemaining,3);
  assert.equal(cat.state.enemies[0].phase,'respawning');assert.equal(cat.state.enemies[0].health,0);
  assert.equal(cat.state.resources[0].amount,1);assert.equal(cat.state.camp.wood,8);
});
