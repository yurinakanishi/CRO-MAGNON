import { WebSocket } from 'ws';
import { writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { CollisionWorld, overlap } from '../dist/shared/collision.mjs';
const peers=[],amounts=new Map(),collision=new CollisionWorld(undefined,{active:o=>!o.resourceId||(amounts.get(o.resourceId)??1)>0});
const report={startedAt:new Date().toISOString(),mode:'Two actual browser clients and three passive WebSocket peers on isolated port 3004',snapshots:0,maxPlayers:0,staticPenetrations:0,dynamicPenetrations:0,mountMismatches:0,mounts:new Set(),clips:new Set(),sixthRefused:false,errors:[]};
for(let i=0;i<3;i++){
  const socket=new WebSocket(`ws://127.0.0.1:3004/ws?room=RIDING-QA&name=RidingObserver${i}&species=${i===1?'nea':'cro'}&gender=${i===2?'male':'female'}`);peers.push(socket);
  socket.on('error',e=>report.errors.push(e.message));socket.on('message',bytes=>{
    const m=JSON.parse(bytes);if(m.type!=='state'||i)return;
    report.snapshots++;report.maxPlayers=Math.max(report.maxPlayers,m.players.length);for(const r of m.resources||[])amounts.set(r.id,r.amount);
    const actors=[...m.players.filter(p=>!p.mountId),...m.animals.filter(a=>['alive','dying'].includes(a.phase)),...m.enemies.filter(e=>['alive','dead'].includes(e.phase))];
    for(const a of actors)if(!collision.free(a,a.radius))report.staticPenetrations++;
    for(let a=0;a<actors.length;a++)for(let b=a+1;b<actors.length;b++)if(overlap(actors[a],actors[a].radius,{...actors[b],type:'circle'}))report.dynamicPenetrations++;
    for(const p of m.players.filter(p=>p.mountId)){
      const a=m.animals.find(a=>a.id===p.mountId);report.mounts.add(p.species+':'+p.mountId);report.clips.add(a?.clip);
      if(!a||a.riderId!==p.id||a.x!==p.x||a.z!==p.z||a.facing!==p.facing)report.mountMismatches++;
    }
    if(m.players.length===5&&!report.probed){report.probed=true;const extra=new WebSocket('ws://127.0.0.1:3004/ws?room=RIDING-QA&name=SixthProbe');extra.on('message',b=>{const s=JSON.parse(b);if(s.code==='ROOM_FULL')report.sixthRefused=true;});extra.on('error',()=>{});extra.on('open',()=>setTimeout(()=>extra.close(),1000));}
  });
}
console.log('Three passive riding observers active; q saves and exits');
const input=createInterface({input:process.stdin});let stopped=false;
async function finish(){if(stopped)return;stopped=true;input.close();peers.forEach(p=>p.terminate());report.mounts=[...report.mounts];report.clips=[...report.clips];report.finishedAt=new Date().toISOString();report.status=report.maxPlayers===5&&report.sixthRefused&&!report.staticPenetrations&&!report.dynamicPenetrations&&!report.mountMismatches&&!report.errors.length?'passed':'failed';await writeFile('assets/riding-network-qa.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));process.exit(report.status==='passed'?0:1);}
input.on('line',line=>{if(line.trim()==='q')finish();});process.on('SIGINT',finish);setTimeout(finish,20*60*1000).unref();
