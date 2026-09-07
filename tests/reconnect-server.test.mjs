import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createGameServer } from '../server.mjs';
import { actorObstacle } from '../shared/animals.mjs';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate){for(let i=0;i<300;i++){if(predicate())return;await sleep(10);}assert.fail('Reconnect condition timed out');}
async function setup(t,options={}){
  const game=createGameServer({port:0,host:'127.0.0.1',tickMs:20,...options});await game.listen();
  const clients=[];t.after(async()=>{for(const client of clients)client.socket.terminate();await game.close();});
  function connect(params={}){
    const client={messages:[],socket:new WebSocket(`ws://127.0.0.1:${game.address().port}/ws?${new URLSearchParams({room:'RESUME',name:'旅人',resume:'1',...params})}`)};
    client.socket.on('message',bytes=>client.messages.push(JSON.parse(bytes)));clients.push(client);
    client.send=message=>client.socket.send(JSON.stringify(message));
    client.welcome=async()=>{await until(()=>client.messages.some(m=>m.type==='welcome'));return client.messages.find(m=>m.type==='welcome');};
    return client;
  }
  return {game,connect};
}

test('a transient disconnect restores identity, position, inventory and the sole-player room',async t=>{
  const {game,connect}=await setup(t),first=connect(),welcome=await first.welcome(),room=game.rooms.get('RESUME'),p=room.players.get(welcome.id);
  Object.assign(p,{x:130,z:50,energy:37,gathered:7,tool:true});Object.assign(p.inventory,{wood:8,stone:3,rawMeat:2});
  room.camp.wood=12;room.camp.stone=6;room.camp.level=1;
  p.cookingEndsAt=Date.now()+3000;p.pendingStrike={impactAt:Date.now()+1000};
  first.socket.terminate();await until(()=>!room.players.size);
  assert.equal(game.rooms.get('RESUME'),room);assert.equal(room.sessions.size,1);
  const second=connect({session:welcome.session,name:'違う名前',species:'cat'}),resumed=await second.welcome();
  assert.equal(resumed.id,welcome.id);assert.equal(resumed.resumed,true);assert.equal(resumed.profile.name,'旅人');
  assert.deepEqual(p.inventory,{wood:8,stone:3,berry:0,rawMeat:2,cookedMeat:0});
  assert.equal(p.energy,37);assert.equal(p.gathered,7);assert.equal(p.tool,true);assert.equal(p.ready,true);
  assert.deepEqual([p.x,p.z],[130,50]);assert.equal(p.pendingStrike,null);assert.equal(p.cookingEndsAt,0);assert.equal(p.speed,0);
  assert.equal(room.sessions.size,0);assert.equal(room.players.size,1);
  assert.equal(JSON.stringify(game.snapshot(room,true)).includes(welcome.session),false,'Resume credentials are private to the owner welcome');
});

test('disconnect releases a mount and reconnect places the rider safely beside it',async t=>{
  const {game,connect}=await setup(t),first=connect(),welcome=await first.welcome(),room=game.rooms.get('RESUME'),p=room.players.get(welcome.id),animal=room.animals[0];
  Object.assign(p,{x:animal.x+animal.radius+.6,z:animal.z});first.send({type:'action',action:'ride',targetId:animal.id});
  await until(()=>p.mountId===animal.id);first.socket.terminate();await until(()=>!room.players.size);
  assert.equal(animal.riderId,null);assert.equal(animal.speed,0);
  const second=connect({session:welcome.session});await second.welcome();
  assert.equal(p.mountId,null);assert.equal(room.collision.free(p,p.radius,room.animals.map(actorObstacle)),true);
  assert.ok(Math.hypot(p.x-animal.x,p.z-animal.z)>p.radius+animal.radius-.001);
});

test('a reload replaces its old connection once without deleting the resumed player',async t=>{
  const {game,connect}=await setup(t),first=connect(),welcome=await first.welcome(),room=game.rooms.get('RESUME'),p=room.players.get(welcome.id),old=p.socket;
  p.inventory.wood=4;
  const second=connect({session:welcome.session});assert.equal((await second.welcome()).resumed,true);
  await until(()=>first.socket.readyState===WebSocket.CLOSED);
  assert.equal(room.players.size,1);assert.equal(room.players.get(p.id),p);assert.notEqual(p.socket,old);
  assert.equal(p.inventory.wood,4);assert.equal(room.sessions.size,0);
  old.emit('message',Buffer.from(JSON.stringify({type:'move',dx:1,dz:0})),false);
  assert.equal(p.dx,0);
});

test('resuming cannot exceed five players and a full-room refusal retains saved items',async t=>{
  const {game,connect}=await setup(t),first=connect(),welcome=await first.welcome(),room=game.rooms.get('RESUME');
  room.players.get(welcome.id).inventory.berry=9;first.socket.terminate();await until(()=>!room.players.size);
  const peers=[];for(let i=0;i<5;i++){const peer=connect({resume:'0',name:`Peer ${i}`});await peer.welcome();peers.push(peer);}
  const refused=connect({session:welcome.session});await until(()=>refused.messages.some(m=>m.code==='ROOM_FULL'));
  assert.equal(room.players.size,5);assert.equal(room.sessions.get(welcome.session).player.inventory.berry,9);
  peers[0].socket.terminate();await until(()=>room.players.size===4);
  const restored=connect({session:welcome.session});assert.equal((await restored.welcome()).id,welcome.id);
  assert.equal(room.players.size,5);assert.equal(room.players.get(welcome.id).inventory.berry,9);
});

test('explicit profile leave discards the old player, while abandoned sessions expire',async t=>{
  const {game,connect}=await setup(t,{resumeGraceMs:90});
  const first=connect();await first.welcome();first.send({type:'leave'});
  await until(()=>!game.rooms.has('RESUME'));
  const second=connect(),welcome=await second.welcome();second.socket.terminate();await until(()=>!game.rooms.get('RESUME')?.players.size);
  assert.ok(game.rooms.has('RESUME'));await until(()=>!game.rooms.has('RESUME'));
  const fresh=connect({session:welcome.session}),newWelcome=await fresh.welcome();
  assert.notEqual(newWelcome.id,welcome.id);assert.equal(newWelcome.resumed,false);
});
