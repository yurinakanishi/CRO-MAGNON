import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createGameCore} from '../dist/application/game-core.mjs';
import {defaultRuntime} from '../dist/application/ports.mjs';
import {WORLD} from '../dist/shared/world.mjs';
import {GULF,GULF_ENTRY,GULF_STOPS,SETTLEMENTS,LANDINGS,FARM_PLOTS,SPRINGS,GULF_LANDMARKS,inGulf} from '../dist/shared/gulf-region.mjs';
import {SCENERY} from '../dist/shared/scenery-layout.mjs';
import {CollisionWorld,staticObstacles} from '../dist/shared/collision.mjs';
import {createGulfState,handleGulfAction} from '../dist/shared/gulf-life.mjs';
import {initializeBoats,launchPoint,BOATING,waterBodyFree} from '../dist/shared/boats.mjs';
import {nearbyChunks,chunkDescription,chunkAt} from '../dist/shared/biomes.mjs';
import {isLand,EARTH,coastTextureData} from '../dist/shared/paleo-geography.mjs';

const collision=new CollisionWorld();
class Socket extends EventEmitter { readyState=1;bufferedAmount=0;messages=[];send(raw){this.messages.push(JSON.parse(raw));}close(){this.readyState=3;this.emit('close');}ping(){}terminate(){this.close();} }
const runtime={...defaultRuntime,now:()=>100000};
function join(core,name,session='') {const socket=new Socket();core.connect(socket,new URLSearchParams({room:'EXPANSION',name,species:'nea',resume:'1',session}));return {socket,player:[...core.rooms.get('EXPANSION').players.values()].find(p=>p.name===name),token:socket.messages.find(m=>m.type==='welcome')?.session};}

test('four-area bounds retain the original Earth projection and bounded near-camera terrain',()=>{
  assert.equal(WORLD.width*WORLD.depth,4*4096*2048);
  assert.equal((GULF.maxX-GULF.minX)*(GULF.maxZ-GULF.minZ),4*740*670);
  assert.equal(EARTH.width,4096);assert.equal(EARTH.height,2048);
  const continentalCorner={x:-1539.234003070742,z:72.73924321308732};
  assert.equal(inGulf(continentalCorner.x,continentalCorner.z),false,'original continental corner is not part of the fantasy gulf');
  assert.ok(SCENERY.trees.some(p=>p.x===continentalCorner.x&&p.z===continentalCorner.z),'original continental tree retained');
  assert.equal(FARM_PLOTS.length,48);assert.equal(GULF_STOPS.length,6);
  const grid=coastTextureData();assert.equal(grid.cell,2);assert.equal(grid.width,4096);assert.equal(grid.height,2048);
  for(const p of [...SETTLEMENTS,...GULF_STOPS]) {
    assert.ok(p.x>WORLD.minX&&p.x<WORLD.maxX&&p.z>WORLD.minZ&&p.z<WORLD.maxZ);
    assert.ok(nearbyChunks(p.x,p.z,128).length<=70);
  }
});

test('all five landings support launch, coastal journeys and two crossings with real hull clearance',()=>{
  const room={collision,players:new Map(),animals:[]};initializeBoats(room);
  const launches=LANDINGS.map(l=>{
    const p=launchPoint(room,{...l,radius:.32});assert.ok(p,l.id);assert.ok(waterBodyFree(p.x,p.z,BOATING.radius));return p;
  });
  for(const [a,b]of[[0,1],[0,2],[1,2],[3,4],[1,3],[2,4]]){
    const path=room.seaCollision.path(launches[a],launches[b],BOATING.radius);assert.ok(path.length,`${a}->${b}`);
    assert.ok(Math.hypot(path.at(-1).x-launches[b].x,path.at(-1).z-launches[b].z)<.1);
    let previous=launches[a],metres=0;
    for(const p of path){assert.ok(room.seaCollision.segmentFree(previous,p,BOATING.radius));metres+=Math.hypot(p.x-previous.x,p.z-previous.z);previous=p;}
    if(a===1&&b===2)assert.ok(metres>600&&metres<750);
  }
});

test('new stops and foothill formations leave every ordinary approach and route usable',()=>{
  for(const p of [...GULF_STOPS.map(s=>({...s,z:s.z+5})),...SPRINGS.map(s=>({...s,z:s.z+2}))]) {
    const path=collision.path(GULF_ENTRY,p,.32);assert.ok(path.length,p.id);
    assert.ok(Math.hypot(path.at(-1).x-p.x,path.at(-1).z-p.z)<.1,p.id);
    let a=GULF_ENTRY;for(const b of path){assert.ok(collision.segmentFree(a,b,.32),p.id);a=b;}
  }
  for(const o of staticObstacles().filter(o=>GULF_LANDMARKS.some(p=>p.id===o.landmarkId)))assert.ok(isLand(o.x,o.z),'rock footprint at sea');
});

test('journey records require visiting each stop and returning to the hub; reward is atomic and persistent',()=>{
  const core=createGameCore({runtime}),{player:p,token}=join(core,'Traveller');const room=core.rooms.get('EXPANSION');
  const act=(action,targetId)=>handleGulfAction(room,p,{action,targetId},100000);
  assert.equal(act('gulfSurvey',GULF_STOPS[0].id).ok,false);
  assert.equal(act('gulfSurvey','forged').ok,false);
  for(const s of GULF_STOPS){Object.assign(p,{x:s.x,z:s.z+5});assert.equal(act('gulfSurvey',s.id).ok,true);assert.equal(act('gulfSurvey',s.id).ok,false);}
  assert.equal(act('gulfTrailReward').ok,false);
  Object.assign(p,{x:GULF_ENTRY.x,z:GULF_ENTRY.z});p.inventory.wood=99;
  assert.equal(act('gulfTrailReward').ok,false);assert.equal(p.gulf.trailRewarded,false);
  p.inventory.wood=0;assert.equal(act('gulfTrailReward').ok,true);assert.equal(p.inventory.wood,6);assert.equal(p.inventory.seed,4);
  assert.equal(act('gulfTrailReward').ok,false);
  const saved=core.exportState(),restored=createGameCore({runtime});restored.importState(saved);
  const resumed=join(restored,'Traveller',token).player;assert.equal(resumed.gulf.waymarks.length,6);assert.equal(resumed.gulf.trailRewarded,true);core.close();restored.close();
});

test('version-three saves move gulf people and boats once while retaining fields, resources and other continents',()=>{
  const source=createGameCore({runtime}),a=join(source,'Farmer'),b=join(source,'Home');
  const room=source.rooms.get('EXPANSION');
  Object.assign(a.player,{x:-1884,z:590,tool:true,gathered:12});
  Object.assign(a.player.inventory,{obsidian:7,seed:3,water:4});a.player.gulf.countryId='long-valley';
  Object.assign(b.player,{x:49,z:57});
  room.gulf.plots[12].stage='growing';room.gulf.plots[12].readyAt=240000;room.gulf.stores.obsidian=3;room.gulf.festivals=2;
  room.resources.find(r=>r.id==='gulf-obsidian-1').amount=2;
  room.boats=[{id:'boat-1',x:-1897.1,z:850,mooring:{x:-1897.1,z:850},shore:{x:-1901,z:850},radius:2,facing:Math.PI/2,riderId:null}];
  const saved=source.exportState();saved.worldVersion=3;saved.rooms[0].gulf.version=1;
  for(const r of saved.rooms[0].resources)if(r.id==='gulf-obsidian-1')Object.assign(r,{x:-2020,z:765});
  const before=JSON.stringify(saved),restored=createGameCore({runtime});restored.importState(saved);
  assert.equal(JSON.stringify(saved),before,'caller checkpoint mutated');
  const pa=join(restored,'Farmer',a.token).player,pb=join(restored,'Home',b.token).player;
  assert.equal(pa.x,SETTLEMENTS[1].x+16);assert.equal(pa.z,SETTLEMENTS[1].z-10);
  assert.equal(pa.inventory.obsidian,7);assert.equal(pa.inventory.seed,3);assert.equal(pa.inventory.water,4);assert.equal(pa.gathered,12);assert.equal(pa.tool,true);
  assert.deepEqual([pb.x,pb.z],[49,57]);
  const next=restored.rooms.get('EXPANSION');assert.equal(next.gulf.plots[12].stage,'growing');assert.equal(next.gulf.plots[12].readyAt,240000);
  assert.equal(next.gulf.stores.obsidian,3);assert.equal(next.gulf.festivals,2);
  const node=next.resources.find(r=>r.id==='gulf-obsidian-1');assert.equal(node.amount,2);assert.equal(node.x,-2770);
  assert.ok(waterBodyFree(next.boats[0].x,next.boats[0].z,2));assert.ok(isLand(next.boats[0].shore.x,next.boats[0].shore.z));
  const twice=createGameCore({runtime});twice.importState(restored.exportState());const p2=join(twice,'Farmer',a.token).player;assert.equal(p2.x,pa.x);assert.equal(p2.z,pa.z);
  source.close();restored.close();twice.close();
});
