// Isolated multiplayer QA only; these peers never alter the normal game room.
import { WebSocket } from 'ws';
import { writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { CollisionWorld, overlap } from '../dist/shared/collision.mjs';
import { biomeAt } from '../dist/shared/biomes.mjs';

const peers=[],amounts=new Map(),collision=new CollisionWorld(undefined,{active:o=>!o.resourceId||(amounts.get(o.resourceId)??1)>0});
const report={startedAt:new Date().toISOString(),mode:'Two actual Chromium browsers and three passive WebSocket peers, isolated port 3004 / WORLD-QA',snapshots:0,maxPlayers:0,biomes:{},staticPenetrations:0,dynamicPenetrations:0,mountMismatches:0,sixthRefused:false,errors:[]};
for(let i=0;i<3;i++){
  const socket=new WebSocket(`ws://127.0.0.1:3004/ws?room=WORLD-QA&name=RegionObserver${i}&species=${i===1?'nea':'cro'}&gender=${i===2?'male':'female'}`);peers.push(socket);
  socket.on('error',error=>report.errors.push(error.message));
  socket.on('message',bytes=>{
    const state=JSON.parse(bytes);if(state.type!=='state'||i)return;
    report.snapshots++;report.maxPlayers=Math.max(report.maxPlayers,state.players.length);
    for(const r of state.resources??[])amounts.set(r.id,r.amount);
    for(const p of state.players){const biome=biomeAt(p.x,p.z).id;report.biomes[biome]=(report.biomes[biome]??0)+1;}
    const actors=[...state.players.filter(p=>!p.mountId),...state.animals.filter(a=>['alive','dying'].includes(a.phase)),...state.enemies.filter(e=>['alive','dead'].includes(e.phase))];
    for(const a of actors)if(!collision.free(a,a.radius))report.staticPenetrations++;
    for(let a=0;a<actors.length;a++)for(let b=a+1;b<actors.length;b++)if(overlap(actors[a],actors[a].radius,{...actors[b],type:'circle'}))report.dynamicPenetrations++;
    for(const p of state.players.filter(p=>p.mountId)){
      const mount=state.animals.find(a=>a.id===p.mountId);
      if(!mount||mount.riderId!==p.id||mount.x!==p.x||mount.z!==p.z||mount.facing!==p.facing)report.mountMismatches++;
    }
    if(state.players.length===5&&!report.probed){
      report.probed=true;const extra=new WebSocket('ws://127.0.0.1:3004/ws?room=WORLD-QA&name=SixthProbe');
      extra.on('message',bytes=>{if(JSON.parse(bytes).code==='ROOM_FULL')report.sixthRefused=true;});extra.on('error',()=>{});extra.on('open',()=>setTimeout(()=>extra.close(),1000));
    }
  });
}
console.log('Three passive regional model observers active; q saves and exits');
const input=createInterface({input:process.stdin});let stopped=false;
async function finish(){
  if(stopped)return;stopped=true;input.close();peers.forEach(p=>p.terminate());report.finishedAt=new Date().toISOString();
  report.status=report.maxPlayers===5&&report.sixthRefused&&['desert','volcano'].every(b=>report.biomes[b]>0)&&!report.staticPenetrations&&!report.dynamicPenetrations&&!report.mountMismatches&&!report.errors.length?'passed':'failed';
  await writeFile('assets/region-specific-network-qa.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));process.exit(report.status==='passed'?0:1);
}
input.on('line',line=>{if(line.trim()==='q')finish();});process.on('SIGINT',finish);setTimeout(finish,30*60*1000).unref();
