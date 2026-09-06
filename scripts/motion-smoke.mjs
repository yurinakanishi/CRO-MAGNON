import {WebSocket} from 'ws';
import {writeFile} from 'node:fs/promises';
import {CollisionWorld,overlap} from '../shared/collision.mjs';
const url=process.argv[2]||'ws://127.0.0.1:3001/ws',room='MOTION-QA';
const sockets=[],timers=[],collision=new CollisionWorld();
const report={room,checks:[],maxPlayers:0,states:0,staticPenetrations:0,dynamicPenetrations:0,fullSnapshotBytes:[],movementSnapshotBytes:[],animalClips:[],species:[]};
const clips=new Set();let measured=false,extraChecked=false;
const send=(s,m)=>{if(s.readyState===WebSocket.OPEN)s.send(JSON.stringify(m));};
const persist=()=>writeFile('assets/motion-network-qa.json',JSON.stringify({...report,animalClips:[...clips]},null,2)+'\n');
async function stop(){timers.forEach(clearInterval);sockets.forEach(s=>s.close());await persist();process.exit(0);}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
for(let i=0;i<4;i++) {
  const socket=new WebSocket(`${url}?room=${room}&name=Movement-QA-${i+1}&species=${i%2?'nea':'cro'}`);sockets.push(socket);
  socket.on('error',error=>console.error(error.message));
  socket.on('message',async bytes=>{
    const m=JSON.parse(bytes);
    if(m.type==='welcome') {
      send(socket,{type:'target',x:46+i*1.3,z:57+i*.5,running:i%2===1});
      if(i===1){let n=0;timers.push(setInterval(()=>send(socket,{type:'target',x:47.3,z:++n%2?54.5:57.5,running:n%2===1}),6000));}
    }
    if(i!==0||m.type!=='state')return;
    report.states++;report.maxPlayers=Math.max(report.maxPlayers,m.players.length);report.species=[...new Set([...report.species,...m.players.map(p=>p.species)])];
    const counts=m.resources?report.fullSnapshotBytes:report.movementSnapshotBytes;if(counts.length<30)counts.push(bytes.length);
    for(const a of m.animals||[])clips.add(a.clip);
    for(const p of [...m.players,...m.animals]) {
      if(!collision.free(p,p.radius||.32))report.staticPenetrations++;
    }
    const actors=[...m.players,...m.animals];
    for(let a=0;a<actors.length;a++)for(let b=a+1;b<actors.length;b++)if(overlap(actors[a],actors[a].radius||.32,{...actors[b],type:'circle',radius:actors[b].radius||.32}))report.dynamicPenetrations++;
    if(m.players.length===5&&!extraChecked){
      extraChecked=true;const extra=new WebSocket(`${url}?room=${room}&name=overflow`);sockets.push(extra);
      extra.on('error',()=>{});extra.on('message',b=>{const e=JSON.parse(b);if(e.code==='ROOM_FULL'){report.checks.push('sixth client refused');console.log('Sixth client: ROOM_FULL');}extra.close();});
    }
    if(report.states%50===0)await persist();
    if(m.players.length===5&&!measured){measured=true;console.log('Five clients connected; both species and collision monitoring active.');}
  });
}
console.log(`Owned QA clients PID ${process.pid}; auto-close after 10 minutes.`);
timers.push(setTimeout(stop,600000));
