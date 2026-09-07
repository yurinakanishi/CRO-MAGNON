import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createGameServer } from '../server.mjs';
import { CollisionWorld } from '../shared/collision.mjs';
import { stopActor } from '../shared/combat.mjs';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function client(url,name){
  const socket=new WebSocket(`${url}?room=RIDE-TEST&name=${name}`),messages=[];
  socket.on('error',()=>{});socket.on('message',data=>messages.push(JSON.parse(data)));
  return {socket,messages,send:m=>socket.send(JSON.stringify(m)),async wait(check,from=0){
    const end=Date.now()+4000;while(Date.now()<end){const m=messages.slice(from).find(check);if(m)return m;await sleep(10);}throw new Error('Expected riding WebSocket event');
  }};
}
test('five peers see exclusive mounts, controlled movement, late joins, safe exits and disconnect release',async t=>{
  const game=createGameServer({port:0,host:'127.0.0.1',tickMs:20});await game.listen();t.after(()=>game.close());
  const url=`ws://127.0.0.1:${game.address().port}/ws`,clients=Array.from({length:5},(_,i)=>client(url,`Rider${i}`));
  const welcomes=await Promise.all(clients.map(c=>c.wait(m=>m.type==='welcome'))),room=game.rooms.get('RIDE-TEST');
  room.collision=new CollisionWorld([],{river:false});room.enemies=[];
  const a=room.animals[0],b=room.animals[1],ps=welcomes.map(w=>room.players.get(w.id));
  for(const [i,p]of ps.entries())Object.assign(p,{x:30+i*2,z:30});
  for(const [i,m]of room.animals.entries()){stopActor(m);Object.assign(m,{x:0,z:i*16,home:{x:0,z:i*16},nextRoam:1e6});}
  Object.assign(ps[0],{x:a.radius+.6,z:0});Object.assign(ps[1],{x:-a.radius-.6,z:0});
  const marks=clients.map(c=>c.messages.length);
  clients[0].send({type:'action',action:'ride',targetId:a.id});clients[1].send({type:'action',action:'ride',targetId:a.id});
  await Promise.all(clients.map((c,i)=>c.wait(m=>m.type==='state'&&m.animals[0].riderId,marks[i])));
  const winner=ps.findIndex(p=>p.id===a.riderId),loser=winner===0?1:0;
  assert.equal(ps.filter(p=>p.mountId===a.id).length,1);assert.equal(ps[loser].mountId,null);
  const rider=ps[winner],before=a.z;
  clients[winner].send({type:'move',dx:0,dz:-1,running:true,targetId:b.id,speed:999,x:999});
  const moved=await clients[winner].wait(m=>m.type==='state'&&m.animals[0].z<before-.15,marks[winner]);
  assert.equal(moved.ridingVersion,1);assert.ok(moved.animals[0].speed<=2.251);assert.equal(moved.animals[0].clip,'Run_Loop');
  const rp=moved.players.find(p=>p.id===rider.id);assert.equal(rp.x,moved.animals[0].x);assert.equal(rp.facing,moved.animals[0].facing);
  const mark=clients[winner].messages.length;clients[winner].send({type:'action',action:'attack'});
  await clients[winner].wait(m=>m.type==='notice'&&m.text.includes('騎乗中'),mark);assert.equal(rider.attackSequence,0);
  clients[4].socket.close();await clients[winner].wait(m=>m.type==='state'&&m.players.length===4,mark);
  const late=client(url,'Late');const joined=await late.wait(m=>m.type==='state');assert.equal(joined.animals[0].riderId,rider.id);assert.equal(joined.players.find(p=>p.id===rider.id).mountId,a.id);
  const sixth=client(url,'Sixth');assert.equal((await sixth.wait(m=>m.type==='error')).code,'ROOM_FULL');
  await sleep(520);const unmountMark=clients[winner].messages.length;clients[winner].send({type:'action',action:'ride'});
  const exited=await clients[winner].wait(m=>m.type==='state'&&!m.animals[0].riderId,unmountMark);const ex=exited.players.find(p=>p.id===rider.id);assert.equal(ex.mountId,null);assert.ok(Math.hypot(ex.x-a.x,ex.z-a.z)>a.radius+ex.radius);
  await sleep(460);clients[winner].send({type:'action',action:'ride',targetId:a.id});await clients[winner].wait(m=>m.type==='state'&&m.animals[0].riderId===rider.id,unmountMark+1);
  const last=late.messages.length;clients[winner].socket.close();await late.wait(m=>m.type==='state'&&!m.animals[0].riderId&&m.players.length===4,last);
  assert.equal(a.dx,0);assert.equal(a.target,null);assert.equal(a.riderId,null);
});
