import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { CollisionWorld } from '../shared/collision.mjs';
import { updateEnemies } from '../shared/enemies.mjs';
import { actorObstacle } from '../shared/animals.mjs';
import { movePlayer } from '../shared/movement.mjs';
import { planNavigation, updateNavigation } from '../shared/navigation.mjs';
import { stopActor } from '../shared/combat.mjs';
import { createGameServer } from '../server.mjs';

const actor=(id,x,z)=>({id,x,z,radius:.32,path:[],lastInput:0,energy:0,inventory:{},downedUntil:100});
const obstacles=(players,player)=>players.filter(other=>other!==player).map(actorObstacle);
function step(player,collision,dynamic,now) {
  const before={x:player.x,z:player.z};
  updateNavigation(player,collision,dynamic,now);
  movePlayer(player,.05,now,(p,dx,dz)=>collision.move(p,dx,dz,p.radius,dynamic));
  assert.ok(collision.free(player,player.radius,dynamic),'Every movement step must remain body-clear');
  assert.ok(Math.hypot(player.x-before.x,player.z-before.z)<=.066,'Navigation must walk without teleporting');
}

test('each member of the actual five-player recovery cluster can walk north to the enemy clearing',()=>{
  for(let selected=0;selected<5;selected++) {
    const collision=new CollisionWorld(),players=Array.from({length:5},(_,i)=>actor(String(i),43+i*1.2,19));
    const room={collision,players:new Map(players.map(p=>[p.id,p])),animals:[],enemies:[],camp:{x:50,z:50}};
    updateEnemies(room,0,100);
    const player=players[selected],dynamic=obstacles(players,player),goal={x:45,z:20};
    assert.equal(player.energy,50);assert.equal(player.downedUntil,0);
    assert.ok(planNavigation(player,goal,collision,dynamic,200),`Recovery slot ${selected} must have an escape path`);
    for(let i=0;i<1200&&player.navigationGoal;i++)step(player,collision,dynamic,200+i*50);
    assert.ok(Math.hypot(player.x-goal.x,player.z-goal.z)<.015,`Recovery slot ${selected} remained blocked at ${player.x},${player.z}`);
    assert.equal(player.navigationGoal,null);
  }
});

test('a peer entering an already planned route triggers a detour without a new click',()=>{
  const collision=new CollisionWorld([],{river:false}),player=actor('walker',50,50),peer=actor('peer',60,50);
  const goal={x:50,z:40};let dynamic=[actorObstacle(peer)],deviated=false;
  planNavigation(player,goal,collision,dynamic,1000);
  for(let i=0;i<4;i++)step(player,collision,dynamic,1000+i*50);
  peer.x=50;peer.z=48.5;dynamic=[actorObstacle(peer)];
  for(let i=4;i<500&&player.navigationGoal;i++) {
    step(player,collision,dynamic,1000+i*50);deviated ||= Math.abs(player.x-50)>.35;
  }
  assert.ok(deviated);assert.ok(Math.hypot(player.x-goal.x,player.z-goal.z)<.015);
});

test('a fully blocked corridor waits and retries when the blocking body moves away',()=>{
  const wall=(x,hx)=>({type:'box',x,z:50,hx,hz:50,c:1,s:0,height:3});
  const collision=new CollisionWorld([wall(24.5,24.5),wall(75.5,24.5)],{river:false});
  const player=actor('walker',50,50),peer={type:'circle',x:50,z:45,radius:1.1},goal={x:50,z:40};
  assert.equal(planNavigation(player,goal,collision,[peer],1000),false);
  for(let i=0;i<20;i++)step(player,collision,[peer],1000+i*50);
  assert.deepEqual({x:player.x,z:player.z},{x:50,z:50});assert.deepEqual(player.navigationGoal,goal);
  for(let i=20;i<400&&player.navigationGoal;i++)step(player,collision,[],1000+i*50);
  assert.ok(Math.hypot(player.x-goal.x,player.z-goal.z)<.015);
});

test('stopping an actor cancels its retained navigation request',()=>{
  const collision=new CollisionWorld([],{river:false}),player=actor('walker',50,50);
  planNavigation(player,{x:50,z:40},collision,[],1000);stopActor(player);
  updateNavigation(player,collision,[],2000);
  assert.equal(player.target,null);assert.deepEqual(player.path,[]);assert.equal(player.navigationGoal,null);
});

test('server target messages leave a recovered five-client crowd and manual input cancels replanning',async t=>{
  const game=createGameServer({port:0,host:'127.0.0.1',tickMs:20}),address=await game.listen(),clients=[];
  t.after(async()=>{for(const client of clients)client.socket.terminate();await game.close();});
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  async function until(predicate,timeout=6000) {
    const end=Date.now()+timeout;while(Date.now()<end){if(predicate())return;await sleep(10);}assert.fail('Server navigation condition timed out');
  }
  for(let i=0;i<5;i++) {
    const client={socket:new WebSocket(`ws://127.0.0.1:${address.port}/ws?room=RECOVERY-PATH&name=P${i}`)};clients.push(client);
    client.socket.on('message',bytes=>{const message=JSON.parse(bytes);if(message.type==='welcome')client.id=message.id;});
    await until(()=>client.id);
  }
  const room=game.rooms.get('RECOVERY-PATH'),players=[...room.players.values()],recoverAt=Date.now()+100;
  for(const [i,player] of players.entries())Object.assign(player,{x:43+i*1.2,z:19,energy:0,downedUntil:recoverAt});
  await until(()=>players.every(player=>!player.downedUntil));
  const client=clients[2],player=room.players.get(client.id);
  client.socket.send(JSON.stringify({type:'target',x:45,z:20,running:true}));
  await until(()=>player.z<50);
  assert.ok(room.collision.free(player,player.radius,obstacles(players,player)));
  assert.ok(player.navigationGoal);
  client.socket.send(JSON.stringify({type:'move',dx:0,dz:0}));
  await until(()=>!player.navigationGoal&&!player.moving);
  const stopped={x:player.x,z:player.z};await sleep(600);
  assert.deepEqual({x:player.x,z:player.z},stopped);assert.equal(player.target,null);
});
