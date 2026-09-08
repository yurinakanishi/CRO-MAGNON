import test from 'node:test';
import assert from 'node:assert/strict';
import {createGameCore} from '../dist/shared/game-core.mjs';
import {createGameServer} from '../server.mjs';
import {handleBoatAction,updateBoats} from '../dist/shared/boats.mjs';
class Socket{readyState=1;bufferedAmount=0;handlers={};messages=[];on(k,f){this.handlers[k]=f;}send(s){this.messages.push(JSON.parse(s));}close(){this.readyState=3;this.handlers.close?.();}input(m){this.handlers.message(Buffer.from(JSON.stringify(m)),false);}}
function setup(){const core=createGameCore({keepEmptyRooms:true}),peers=[];for(let i=0;i<5;i++){const s=new Socket();core.connect(s,new URLSearchParams({room:'BOAT-QA',name:`P${i}`,resume:'1'}));peers.push(s);}const room=core.rooms.get('BOAT-QA'),p=[...room.players.values()][0];Object.assign(p,{x:21,z:125});p.inventory.wood=24;return {core,peers,room,p};}
const action=(s,p,action)=>{p.lastAction=0;s.input({type:'action',action});};
test('five clients see the same crafted hull and occupancy; input controls hull and mounted actions are rejected',()=>{
  const {core,room,p,peers}=setup(),s=peers[0];
  try{action(s,p,'craftBoat');assert.equal(p.inventory.wood,12);
    for(const peer of peers)assert.equal(peer.messages.filter(m=>m.type==='state').at(-1).boats.length,1);
    action(s,p,'boardBoat');assert.equal(p.boatId,room.boats[0].id);
    for(const peer of peers){const last=peer.messages.filter(m=>m.type==='state').at(-1);assert.equal(last.boats[0].riderId,p.id);assert.equal(last.players.find(q=>q.id===p.id).boatId,p.boatId);}
    s.input({type:'move',dx:0,dz:1,running:true});assert.equal(room.boats[0].dz,1);assert.equal(p.dz,0);
    const old={x:p.x,z:p.z},inventory={...p.inventory};action(s,p,'attack');action(s,p,'ride');action(s,p,'craft');s.input({type:'expedition',destination:'sahul'});
    assert.equal(p.attackSequence,0);assert.equal(p.mountId,null);assert.equal(p.x,old.x);assert.deepEqual(p.inventory,inventory);
    const sixth=new Socket();core.connect(sixth,new URLSearchParams({room:'BOAT-QA'}));assert.equal(sixth.messages[0].code,'ROOM_FULL');
  }finally{core.close();}
});
test('active replacement, disconnect and durable restart restore possessions at the safe shore',()=>{
  const {core,room,p,peers}=setup(),s=peers[0];let restored;
  try{action(s,p,'craftBoat');action(s,p,'boardBoat');const welcome=s.messages.find(m=>m.type==='welcome');
    const b=room.boats[0];b.dz=1;b.lastInput=Date.now();updateBoats(room,.1,Date.now());
    const saved=JSON.parse(JSON.stringify(core.exportState()));restored=createGameCore({keepEmptyRooms:true});restored.importState(saved);
    const fresh=new Socket();restored.connect(fresh,new URLSearchParams({room:'BOAT-QA',resume:'1',session:welcome.session}));
    const rp=restored.rooms.get('BOAT-QA').players.get(p.id);assert.equal(rp.boatId,null);assert.equal(rp.inventory.wood,12);assert.equal(rp.x,21);assert.equal(rp.z,125);
    assert.equal(restored.rooms.get('BOAT-QA').boats[0].riderId,null);
    const replacement=new Socket();core.connect(replacement,new URLSearchParams({room:'BOAT-QA',resume:'1',session:welcome.session}));assert.equal(p.boatId,null);assert.equal(p.x,21);assert.equal(p.z,125);assert.equal(b.riderId,null);
    action(replacement,p,'boardBoat');replacement.close();assert.equal(b.riderId,null);assert.equal(room.sessions.get(welcome.session).player.boatId,null);assert.equal(room.sessions.get(welcome.session).player.inventory.wood,12);
  }finally{core.close();restored?.close();}
});
test('pre-boat world saves load without losing existing world progress',()=>{
  const{core}=setup();const saved=core.exportState();delete saved.rooms[0].boats;const restored=createGameCore();try{restored.importState(saved);assert.deepEqual(restored.rooms.get('BOAT-QA').boats,[]);}finally{core.close();restored.close();}
});
test('native server exposes the status preflight used before browser WebSocket connection',async()=>{
  const game=createGameServer({port:0,host:'127.0.0.1'});try{const address=await game.listen(),response=await fetch(`http://127.0.0.1:${address.port}/api/status`);assert.equal(response.status,200);const body=await response.json();assert.equal(body.ok,true);assert.equal(body.boatingVersion,1);assert.equal(body.room,undefined);}finally{await game.close();}
});
