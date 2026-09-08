import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createGameCore } from '../dist/application/game-core.mjs';
import { CollisionWorld } from '../dist/shared/collision.mjs';
import { COAST_GRID, COAST_RUNS } from '../dist/shared/paleo-coast-data.mjs?gulf-baseline';
import { coastTextureData, EARTH, isLand } from '../dist/shared/paleo-geography.mjs';
import { COUNTRIES, FARM_PLOTS, GULF, GULF_ENTRY, GULF_RESOURCES, GULF_WAYPOINTS, inGulf, LANDINGS, MANY_HEARTHS, OBSIDIAN_OUTCROPS, SETTLEMENTS, SPRINGS } from '../dist/shared/gulf-region.mjs';
import { createGulfState, ensureGulfPlayer, handleGulfAction, updateGulf } from '../dist/shared/gulf-life.mjs';
import { initializeBoats, launchPoint, waterBodyFree, handleBoatAction, BOATING } from '../dist/shared/boats.mjs';
import { interactionVisible } from '../dist/shared/interactions.mjs';
import { takeExpedition } from '../dist/shared/expeditions.mjs';

const collision = new CollisionWorld();
const makePlayer = (id = 'p') => ({id, species:'nea', radius:.32, x:MANY_HEARTHS.x, z:MANY_HEARTHS.z+5, energy:40, inventory:{wood:0,stone:0,berry:0,rawMeat:0,cookedMeat:0}, path:[]});
const makeRoom = (...players) => { const room={players:new Map(players.map(p=>[p.id,p])),collision,animals:[],enemies:[],gulf:createGulfState(),createdAt:10000};initializeBoats(room);return room; };
const act = (r,p,action,targetId,now=10000) => handleGulfAction(r,p,{action,targetId},now);
class Socket extends EventEmitter {
  readyState=1; bufferedAmount=0; messages=[];
  send(s){this.messages.push(JSON.parse(s));} close(){this.readyState=3;this.emit('close');} ping(){} terminate(){this.close();}
  command(value){this.emit('message',Buffer.from(JSON.stringify(value)),false);}
}

test('fantasy gulf changes only its reserved ocean; original land cells and other coasts are preserved', () => {
  const raw=new Uint8Array(COAST_GRID.width*COAST_GRID.height);let offset=0;
  for(let i=0;i<COAST_RUNS.length;i+=2){raw.fill(COAST_RUNS[i+1],offset,offset+COAST_RUNS[i]);offset+=COAST_RUNS[i];}
  const actual=coastTextureData().data;let additions=0;
  for(let i=0;i<raw.length;i++)if(actual[i]!==raw[i]){
    const x=EARTH.minX+(i%COAST_GRID.width+.5)*COAST_GRID.cell,z=EARTH.minZ+(Math.floor(i/COAST_GRID.width)+.5)*COAST_GRID.cell;
    assert.ok(inGulf(x,z),`changed outside gulf ${x},${z}`);assert.ok(raw[i]<=128,'existing land changed');assert.ok(actual[i]>=raw[i]);additions++;
  }
  assert.ok(additions>10000);assert.equal(isLand(-1760,870),false,'central gulf remains water');
});

test('countries, all 48 crop plots, spring approaches and quarry have safe connected walking routes', () => {
  const start={...GULF_ENTRY};
  for(const p of [...GULF_WAYPOINTS,...FARM_PLOTS.map(p=>({...p,z:p.z+1.3})),...SPRINGS.map(p=>({...p,z:p.z+2}))]){
    assert.ok(collision.free(p,.32),`blocked ${p.id}`);
    const route=collision.path(start,p,.32);assert.ok(route.length,`unreachable ${p.id}`);
    let previous=start;for(const node of route){assert.ok(collision.segmentFree(previous,node,.32),`unsafe path ${p.id}`);previous=node;}
  }
  for(const r of [...GULF_RESOURCES,...OBSIDIAN_OUTCROPS]){
    const approach=collision.nearestFree({x:r.x,z:r.z+2},.32);assert.ok(approach && interactionVisible(collision,approach,r),r.id);
  }
  for(const c of COUNTRIES)assert.deepEqual(new Set(GULF_RESOURCES.filter(r=>r.id.startsWith(`gulf-${c.id}-`)).map(r=>r.type)),new Set(['wood','stone','berry']));
  assert.equal(FARM_PLOTS.length,48);
});

test('all three beaches launch real boats, with an unobstructed cross-gulf water route and a land alternative', () => {
  const p=makePlayer(),r=makeRoom(p),launches=LANDINGS.map(l=>{Object.assign(p,l,{id:'p'});const result=launchPoint(r,p);assert.ok(result,l.id);assert.ok(waterBodyFree(result.x,result.z,BOATING.radius));return result;});
  const route=r.seaCollision.path(launches[1],launches[2],BOATING.radius);assert.ok(route.length);
  let a=launches[1];for(const b of route){assert.ok(r.seaCollision.segmentFree(a,b,BOATING.radius));a=b;}
  assert.ok(collision.path(LANDINGS[1],LANDINGS[2],.32).length);
  Object.assign(p,LANDINGS[1],{id:'p'});p.inventory.wood=12;
  assert.equal(handleBoatAction(r,p,{action:'craftBoat'},10000).changed,true);assert.equal(p.inventory.wood,0);
  assert.equal(handleBoatAction(r,p,{action:'boardBoat'},11000).changed,true);assert.ok(p.boatId);
  assert.equal(act(r,p,'gulfPlant',FARM_PLOTS[0].id).ok,false);
});

test('farming requires local planting and carried water; concurrent tending and harvest resolve once', () => {
  const p=makePlayer(),other=makePlayer('other'),r=makeRoom(p,other),spec=FARM_PLOTS[0];
  assert.equal(act(r,p,'gulfWelcome').ok,true);assert.equal(p.inventory.seed,6);assert.equal(act(r,p,'gulfWelcome').ok,false);
  assert.equal(act(r,p,'gulfPlant',spec.id).ok,false,'remote planting rejected');
  Object.assign(p,spec,{id:'p'});assert.equal(act(r,p,'gulfPlant',spec.id).ok,true);assert.equal(p.inventory.seed,5);
  assert.equal(act(r,p,'gulfTend',spec.id).ok,false,'water needed');
  Object.assign(p,SPRINGS[0],{id:'p'});assert.equal(act(r,p,'gulfWater').ok,true);assert.equal(p.inventory.water,6);
  Object.assign(p,spec,{id:'p'});assert.equal(act(r,p,'gulfTend',spec.id).ok,true);assert.equal(p.inventory.water,5);
  Object.assign(other,spec,{id:'other'});ensureGulfPlayer(other);other.inventory.water=2;
  assert.equal(act(r,other,'gulfTend',spec.id).ok,false);assert.equal(other.inventory.water,2);
  assert.equal(act(r,p,'gulfHarvest',spec.id,189999).ok,false);updateGulf(r,190000);
  assert.equal(act(r,p,'gulfHarvest',spec.id,190000).ok,true);assert.equal(act(r,other,'gulfHarvest',spec.id,190000).ok,false);
  assert.equal(p.inventory.berry,7);assert.equal(p.inventory.seed,7);assert.equal(other.inventory.berry,0);assert.equal(p.gulf.harvested,1);
});

test('crop failures preserve inventory, growth and ripe harvests; walls and invalid IDs cannot be bypassed', () => {
  const p=makePlayer(),r=makeRoom(p),spec=FARM_PLOTS[0];ensureGulfPlayer(p);Object.assign(p,spec,{id:'p'});
  assert.equal(act(r,p,'gulfPlant','unknown').ok,false);assert.equal(act(r,p,'gulfPlant',spec.id).ok,false);
  p.inventory.seed=1;r.collision={segmentFree:()=>false};assert.equal(act(r,p,'gulfPlant',spec.id).ok,false);assert.equal(p.inventory.seed,1);
  r.collision=collision;r.gulf.plots[0].stage='ripe';p.inventory.berry=98;
  assert.equal(act(r,p,'gulfHarvest',spec.id).ok,false);assert.equal(r.gulf.plots[0].stage,'ripe');assert.equal(p.inventory.seed,1);
  for(const key of ['mountId','boatId','downedUntil']){p[key]=1;assert.equal(act(r,p,'gulfHarvest',spec.id).ok,false);p[key]=null;}
});

test('country affiliation is independent of species, requires visiting and does not close access to other communities', () => {
  const p=makePlayer(),r=makeRoom(p);assert.equal(act(r,p,'gulfJoin',COUNTRIES[0].id).ok,false);
  for(const c of COUNTRIES){Object.assign(p,c,{id:'p',z:c.z+5});assert.equal(act(r,p,'gulfJoin',c.id).ok,true);updateGulf(r,10000);assert.equal(p.species,'nea');}
  assert.equal(p.gulf.visited.length,3);assert.equal(p.gulf.countryId,COUNTRIES[2].id);
  assert.equal(takeExpedition(r,p,GULF_ENTRY.id,10000).ok,false,'local return is by land or boat');
});

test('obsidian exchange and shared feast account for costs and issue each reward at most once per feast', () => {
  const p=makePlayer(),r=makeRoom(p);ensureGulfPlayer(p);p.inventory.obsidian=2;
  assert.equal(act(r,p,'gulfExchange').ok,true);assert.equal(p.inventory.obsidian,0);assert.equal(p.inventory.wood,6);assert.equal(p.inventory.seed,2);
  assert.equal(act(r,p,'gulfOffer','__proto__').ok,false);p.inventory.wood=8;p.inventory.berry=12;p.inventory.obsidian=4;
  for(const key of ['wood','berry','obsidian'])for(let i=0;i<4;i++)assert.equal(act(r,p,'gulfOffer',key).ok,true);
  assert.equal(r.gulf.festivals,1);assert.deepEqual(r.gulf.stores,{wood:0,berry:0,obsidian:0});
  assert.equal(act(r,p,'gulfFeast').ok,true);const inventory={...p.inventory};assert.equal(act(r,p,'gulfFeast').ok,false);assert.deepEqual(p.inventory,inventory);
});

test('real commands gather obsidian; reconnect and save/restore preserve crops, affiliation and all inventory', () => {
  let now=10000;const runtime={now:()=>now,id:()=>crypto.randomUUID(),token:()=>crypto.randomUUID()};
  const core=createGameCore({runtime}),socket=new Socket();core.connect(socket,new URLSearchParams({room:'GULF',resume:'1'}));
  const room=core.rooms.get('GULF'),p=[...room.players.values()][0],rock=OBSIDIAN_OUTCROPS[0];
  Object.assign(p,{x:rock.x,z:rock.z+2});socket.command({type:'action',action:'gather',targetId:rock.id,amount:99});assert.equal(p.inventory.obsidian,1);assert.equal(p.gulf.procured,1);
  p.gulf.countryId=COUNTRIES[1].id;Object.assign(p,{x:FARM_PLOTS[0].x,z:FARM_PLOTS[0].z+1.3});p.inventory.seed=2;p.inventory.water=1;
  now+=500;socket.command({type:'action',action:'gulfPlant',targetId:FARM_PLOTS[0].id});now+=500;socket.command({type:'action',action:'gulfTend',targetId:FARM_PLOTS[0].id});
  const saved=core.exportState(),token=p.sessionToken;socket.close();const fresh=new Socket();core.connect(fresh,new URLSearchParams({room:'GULF',resume:'1',session:token}));assert.deepEqual([...room.players.values()][0].gulf,p.gulf);
  const restored=createGameCore({runtime});restored.importState(saved);const rs=new Socket();restored.connect(rs,new URLSearchParams({room:'GULF',resume:'1',session:token}));
  const rp=[...restored.rooms.get('GULF').players.values()][0];assert.deepEqual(rp.inventory,p.inventory);assert.deepEqual(rp.gulf,p.gulf);
  now=room.gulf.plots[0].readyAt+1;restored.tick();assert.equal(restored.rooms.get('GULF').gulf.plots[0].stage,'ripe','offline growth catches up');
  const publicState=restored.snapshot(restored.rooms.get('GULF'),true);assert.equal(JSON.stringify(publicState).includes(token),false);
  const old=structuredClone(saved);for(const r of old.rooms){delete r.gulf;r.resources=r.resources.filter(r=>!r.id.startsWith('gulf-'));for(const e of r.sessions){delete e.player.gulf;delete e.player.inventory.obsidian;delete e.player.inventory.seed;delete e.player.inventory.water;}}
  const migrated=createGameCore({runtime:{...runtime,now:()=>11000}});migrated.importState(old);const ms=new Socket();migrated.connect(ms,new URLSearchParams({room:'GULF',resume:'1',session:token}));
  const mr=migrated.rooms.get('GULF');assert.equal(mr.gulf.plots.length,48);assert.equal([...mr.players.values()][0].inventory.seed,0);assert.ok(mr.resources.some(r=>r.type==='obsidian'));
  core.close();restored.close();migrated.close();
});

test('five remains the default connection cap; an eight-player core uses the same 48 plots and countries', () => {
  for(const limit of [5,8]){const core=createGameCore(limit===5?{}:{playerLimit:limit});const sockets=[];
    for(let i=0;i<limit+1;i++){const s=new Socket();core.connect(s,new URLSearchParams({room:'CAP'}));sockets.push(s);}
    const room=core.rooms.get('CAP');assert.equal(room.players.size,limit);assert.equal(room.gulf.plots.length,48);assert.equal(core.snapshot(room).playerLimit,limit);assert.equal(sockets.at(-1).readyState,3);
    core.close();
  }
});
