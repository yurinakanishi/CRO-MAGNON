// Verify the running server in a separate room without touching the player's game.
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { riverX } from '../shared/terrain.mjs';

const socket=new WebSocket(`ws://127.0.0.1:3000/ws?room=RIVER-QA-${Date.now()}&name=RiverQA`);
const z=52,x=riverX(z),targets=[{x:x-4,z},{x:x+4,z}];
let id,stage=0,crossed=false,timer,last;
const deadline=setTimeout(()=>finish(new Error(`Crossing timed out: ${JSON.stringify({stage,last})}`)),30000);
function finish(error){
  clearTimeout(deadline);clearInterval(timer);socket.terminate();
  if(error){console.error(error);process.exitCode=1;}
  else console.log('PASS: live port 3000, click crosses east away from bridge; keyboard crosses back west.');
}
socket.on('error',finish);
socket.on('message',bytes=>{
  const message=JSON.parse(bytes);
  if(message.type==='welcome'){
    id=message.id;socket.send(JSON.stringify({type:'gait',running:true}));
    socket.send(JSON.stringify({type:'target',...targets[0]}));
  }
  if(message.type!=='state')return;
  const p=message.players.find(p=>p.id===id);if(!p)return;last={x:p.x,z:p.z};
  if(stage<2&&Math.hypot(p.x-targets[stage].x,p.z-z)<.1){
    stage++;
    if(stage===1)socket.send(JSON.stringify({type:'target',...targets[1]}));
    else {
      crossed=true;
      timer=setInterval(()=>socket.send(JSON.stringify({type:'move',dx:-1,dz:0,running:true})),80);
    }
  }else if(stage===2&&p.x<=x-4){
    assert.ok(crossed&&Math.abs(p.z-z)<.1);stage=3;finish();
  }
});
