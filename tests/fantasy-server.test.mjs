import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createGameServer } from '../server.mjs';
import { CollisionWorld } from '../shared/collision.mjs';
import { stopActor } from '../shared/combat.mjs';

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function client(url,character,room='FANTASY') {
  const socket=new WebSocket(`${url}?${new URLSearchParams({room,name:character.name,...character})}`),messages=[];
  socket.on('error',()=>{});socket.on('message',data=>messages.push(JSON.parse(data)));
  return {socket,messages,send:message=>socket.send(JSON.stringify(message)),async wait(check,from=0){
    const until=Date.now()+4500;while(Date.now()<until){const message=messages.slice(from).find(check);if(message)return message;await sleep(10);}
    throw new Error(`Expected network event; recent: ${JSON.stringify(messages.slice(-2))}`);
  }};
}

test('five mixed characters synchronize real magic flight, late join, hostile damage and the six-player limit',async t=>{
  const game=createGameServer({port:0,host:'127.0.0.1',tickMs:20});await game.listen();t.after(()=>game.close());
  const url=`ws://127.0.0.1:${game.address().port}/ws`;
  const choices=[{name:'Human'},{name:'Neighbour',species:'nea',gender:'male'},{name:'Kunoichi',species:'cat',gender:'male'},{name:'Mage',species:'bear'},{name:'Mage2',species:'bear',gender:'invalid'}];
  const clients=choices.map(choice=>client(url,choice));const welcomes=await Promise.all(clients.map(c=>c.wait(m=>m.type==='welcome')));
  const snapshots=await Promise.all(clients.map(c=>c.wait(m=>m.type==='state'&&m.players.length===5)));
  for(const state of snapshots){
    assert.equal(state.characterVersion,2);assert.equal(state.combatVersion,3);
    assert.deepEqual(state.players.map(p=>`${p.species}/${p.gender}`).sort(),['bear/female','bear/female','cat/female','cro/female','nea/male']);
  }
  const sixth=client(url,{name:'Sixth'});assert.equal((await sixth.wait(m=>m.type==='error')).code,'ROOM_FULL');
  const separate=client(url,{name:'Separate',species:'bear'},'SEPARATE');await separate.wait(m=>m.type==='welcome');
  const room=game.rooms.get('FANTASY'),mage=room.players.get(welcomes[3].id),animal=room.animals[0];
  room.enemies=[];room.animals=[animal];room.collision=new CollisionWorld([],{river:false});
  for(const [i,p] of [...room.players.values()].entries())Object.assign(p,{x:30+i*2,z:30});
  Object.assign(mage,{x:20,z:20,facing:0});stopActor(animal);Object.assign(animal,{x:20,z:26,radius:.5,health:25,age:40,nextRoam:200});
  const marks=clients.map(c=>c.messages.length);clients[3].send({type:'action',action:'attack',weapon:'spear',damage:999,reach:100});
  const flights=await Promise.all(clients.map((c,i)=>c.wait(m=>m.type==='state'&&m.projectiles.length===1,marks[i])));
  for(const s of flights){assert.equal(s.animals[0].health,25);assert.equal(s.projectiles[0].ownerId,mage.id);assert.equal(s.projectiles[0].kind,'magic');}
  clients[0].socket.close();await clients[3].wait(m=>m.type==='state'&&m.players.length===4,marks[3]);
  const late=client(url,{name:'Late',species:'cat'});const joined=await late.wait(m=>m.type==='state');
  assert.equal(joined.players.length,5);assert.equal(joined.projectiles.length,1);assert.equal(joined.projectiles[0].id,flights[0].projectiles[0].id);
  const defeated=await late.wait(m=>m.type==='state'&&m.animals[0].phase==='dying');
  assert.equal(defeated.animals[0].health,0);assert.equal(defeated.projectiles.length,0);assert.ok(defeated.projectileImpacts.some(impact=>impact.hit));
  const meat=await late.wait(m=>m.type==='state'&&m.animals[0].phase==='meat');assert.equal(meat.animals[0].meatRemaining,4);
  assert.ok(separate.messages.filter(m=>m.type==='state').every(m=>m.projectiles.length===0));
  assert.equal(mage.energy,96);assert.ok([...room.players.values()].filter(p=>p!==mage).every(p=>p.energy===100));
});

test('the kunoichi uses a katana over the public action protocol and holds position for its own attack duration',async t=>{
  const game=createGameServer({port:0,host:'127.0.0.1',tickMs:15});await game.listen();t.after(()=>game.close());
  const c=client(`ws://127.0.0.1:${game.address().port}/ws`,{name:'Katana',species:'cat'});const welcome=await c.wait(m=>m.type==='welcome');
  const room=game.rooms.get('FANTASY'),p=room.players.get(welcome.id),animal=room.animals[0];room.enemies=[];room.animals=[animal];room.collision=new CollisionWorld([],{river:false});
  stopActor(animal);Object.assign(animal,{x:20,z:22,radius:.5,health:100,age:40,nextRoam:200});Object.assign(p,{x:20,z:20.55,facing:0});
  c.send({type:'action',action:'attack',targetId:animal.id,damage:999,weapon:'magic'});
  await c.wait(m=>m.type==='state'&&m.players[0].attackSequence===1);assert.equal(p.radius,.32);
  c.send({type:'target',x:24,z:20.55,running:true});
  await c.wait(m=>m.type==='state'&&m.animals[0].health===75);assert.equal(p.x,20);assert.equal(room.projectiles.length,0);
  const attackAt=p.attackAt,afterHit=c.messages.length;await c.wait(m=>m.type==='state'&&m.players[0].x>20.04,afterHit);
  assert.ok(Date.now()-attackAt>=600);assert.equal(p.attackSequence,1);assert.equal(animal.health,75);
});
