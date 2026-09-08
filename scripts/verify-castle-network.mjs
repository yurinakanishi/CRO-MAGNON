import {readFile,writeFile} from 'node:fs/promises';
import {CollisionWorld,overlap} from '../dist/shared/collision.mjs';
import {CASTLE_SURFACE} from '../dist/shared/castle-surface.mjs';
const states=JSON.parse(await readFile('output/castle-network-observations.json','utf8')),collision=new CollisionWorld();
const errors=[],counts={states:states.length,actors:0,castleActors:0,projectiles:0,maximumParticipants:0},heights={},events={katanaKills:false,magicKills:false,recovery:false,respawn:false};
const deadTimes=[];let previousAlive=true;
for(const state of states){
  counts.maximumParticipants=Math.max(counts.maximumParticipants,state.players.length);
  const actors=[...state.players,...state.animals.filter(a=>['alive','dying'].includes(a.phase)),...state.enemies.filter(e=>['alive','dead'].includes(e.phase))];
  for(const actor of actors){counts.actors++;const h=CASTLE_SURFACE.height(actor.x,actor.z);if(h>1){counts.castleActors++;if(actor.name)heights[actor.name]=Math.max(heights[actor.name]??0,h);}
    if(!collision.free(actor,actor.radius))errors.push({at:state.serverTime,id:actor.id,type:'static-or-coast',x:actor.x,z:actor.z});
  }
  for(let i=0;i<actors.length;i++)for(let j=i+1;j<actors.length;j++){
    const a=actors[i],b=actors[j];if(a.mountId===b.id||b.mountId===a.id)continue;
    const hit=overlap(a,a.radius,{...b,type:'circle'});if(hit?.depth>.002)errors.push({at:state.serverTime,a:a.id,b:b.id,type:'dynamic',depth:hit.depth});
  }
  counts.projectiles+=state.projectiles.length;
  for(const p of state.projectiles)if(p.elevation>17.5)events.magicOnUpperFloor=true;
  const a=state.players.find(p=>p.name==='城探索A');if(a?.defeatSequence&&a.downedUntil===0&&Math.hypot(a.x-49,a.z-53)<1&&a.inventory.cookedMeat===4)events.recovery=true;
  if(state.label==='A'){
    const e=state.enemies[0];if(previousAlive&&e.health===0)deadTimes.push(state.serverTime);if(!previousAlive&&e.health>0)events.respawn=true;previousAlive=e.health>0;
    if(e.health===0&&a?.attackSequence>=4)events.katanaKills=true;
    if(e.health===0&&state.players.find(p=>p.name==='城通信1')?.attackSequence>=3)events.magicKills=true;
  }
}
const result={status:errors.length?'failed':'passed',...counts,violations:errors.length,errors:errors.slice(0,30),maximumFloorHeightByPlayer:heights,events,deathTimes:deadTimes,method:'Two real browser clients and three WebSocket game participants. Normal UI path from camp through gate/stairs to hall for A; 390x844 map path to gate/hall and attack for B. Server-only stdin fixtures staged combat and the five-person visual lineup; fixture teleports are not navigation evidence. Body positions checked against shared coast, static and measured castle collision plus every solid dynamic pair.'};
await writeFile('assets/valley-castle-network-qa.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
if(errors.length)process.exitCode=1;
