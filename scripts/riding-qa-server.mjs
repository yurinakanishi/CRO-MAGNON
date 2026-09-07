// Isolated fixture placement over stdin only. Riding itself uses the public UI
// and normal WebSocket actions. Never start this server on the user's port.
import { createInterface } from 'node:readline';
import { createGameServer } from '../server.mjs';
import { actorObstacle } from '../shared/animals.mjs';
import { stopActor } from '../shared/combat.mjs';
import { releaseRider } from '../shared/riding.mjs';
const game=createGameServer({port:3004,host:'127.0.0.1'});
await game.listen();console.log('Riding QA ready on 3004, RIDING-QA');
const input=createInterface({input:process.stdin});
input.on('line',line=>{
  try {
    const command=JSON.parse(line),room=game.rooms.get('RIDING-QA');if(!room)throw new Error('No QA players');
    const animal=room.animals[command.animal??0];
    if(!animal)throw new Error('Unknown animal');
    for(const p of room.players.values()){
      if(command.name&&p.name!==command.name)continue;
      releaseRider(room,p);
      const dynamic=[...room.players.values()].filter(other=>other!==p).concat(room.animals.filter(a=>a.phase==='alive'),room.enemies).map(actorObstacle);
      const goal={x:animal.x+animal.radius+.55,z:animal.z};
      const point=room.collision.nearestFree(goal,p.radius,dynamic,6);if(!point)throw new Error('No safe staging location');
      Object.assign(p,point,{facing:-Math.PI/2});stopActor(p);
    }
    console.log(JSON.stringify({status:'staged',animal:animal.id,players:[...room.players.values()].map(p=>({name:p.name,x:p.x,z:p.z,mountId:p.mountId}))}));
  }catch(error){console.error(error.message);}
});
const close=async()=>{input.close();await game.close();process.exit(0);};process.once('SIGINT',close);process.once('SIGTERM',close);
