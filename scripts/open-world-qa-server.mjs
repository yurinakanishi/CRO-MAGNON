// Isolated local QA server. Fixture control is stdin only; the web protocol
// cannot relocate players or modify inventory. Never used as the normal server.
import { createInterface } from 'node:readline';
import { createGameServer } from '../server.mjs';
import { JOURNEY_STOPS } from '../shared/biomes.mjs';
import { WORLD } from '../shared/world.mjs';
import { stopActor, enemyIsSolid } from '../shared/combat.mjs';
import { actorObstacle } from '../shared/animals.mjs';
import { animalIsSolid } from '../shared/hunting.mjs';
const game=createGameServer({port:3004,host:'127.0.0.1'});
await game.listen();console.log(JSON.stringify({status:'ready',port:3004,room:'WORLD-QA'}));
const input=createInterface({input:process.stdin});
input.on('line',line=>{
  try {
    const command=JSON.parse(line),room=game.rooms.get('WORLD-QA');
    if(!room)throw new Error('The isolated WORLD-QA room has no players');
    const stop=JOURNEY_STOPS.find(s=>s.id===command.biome)??(Number.isFinite(command.x)&&Number.isFinite(command.z)&&command.x>WORLD.minX+4&&command.x<WORLD.maxX-4&&command.z>WORLD.minZ+4&&command.z<WORLD.maxZ-4?{id:'boundary-fixture',x:command.x,z:command.z}:null);if(!stop)throw new Error('Unknown biome or invalid isolated fixture');
    const players=[...room.players.values()],placed=[];
    for(const [i,p]of players.entries()) {
      const dynamic=placed.map(actorObstacle).concat(room.animals.filter(animalIsSolid).map(actorObstacle),room.enemies.filter(enemyIsSolid).map(actorObstacle));
      const point=room.collision.nearestFree({x:stop.x+(i%3-1)*1.4,z:stop.z+Math.floor(i/3)*1.4},p.radius,dynamic,12);
      if(!point)throw new Error('No body-clear QA arrival');
      stopActor(p);Object.assign(p,point,{facing:Math.PI,energy:100});placed.push(p);
    }
    console.log(JSON.stringify({status:'positioned',biome:stop.id,players:placed.map(p=>({id:p.id,x:p.x,z:p.z}))}));
  }catch(error){console.error(error.message);}
});
const close=async()=>{input.close();await game.close();process.exit(0);};process.once('SIGINT',close);process.once('SIGTERM',close);
