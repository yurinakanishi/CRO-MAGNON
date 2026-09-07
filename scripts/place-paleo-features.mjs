import { writeFile } from 'node:fs/promises';
import { CollisionWorld, staticObstacles } from '../shared/collision.mjs';
import { geoToWorld, EXPEDITION_STOPS, isLand } from '../shared/paleo-geography.mjs';
import { seededRandom } from '../shared/scenery-layout.mjs';
import { biomeAt, roadDistance } from '../shared/biomes.mjs';
import { nearLandmark } from '../shared/landmarks.mjs';
const keys=new Set(['desert-cactus','volcanic-basalt-columns']);
const collision=new CollisionWorld(staticObstacles().filter(o=>!keys.has(o.modelKey)));
const random=seededRandom(50000907),placed=[];
for(const [key,biome,count,centres,spread] of [
  ['desert-cactus','desert',48,[geoToWorld(-112,30)],90],
  ['volcanic-basalt-columns','volcano',18,[geoToWorld(43,39.5),geoToWorld(36,-3),geoToWorld(-122,43)],60],
]){
  let total=0;
  for(let attempt=0;attempt<50000&&total<count;attempt++){
    const centre=centres[attempt%centres.length],x=+(centre.x+(random()-.5)*spread*2).toFixed(2),z=+(centre.z+(random()-.5)*spread*2).toFixed(2);
    const scale=+(.78+random()*.47).toFixed(2),clearance=+(scale*(biome==='desert'?.8:2.5)).toFixed(2);
    if(biomeAt(x,z).id!==biome||!isLand(x,z,clearance+4)||roadDistance(x,z)<clearance+5||nearLandmark(x,z,clearance+3))continue;
    if(EXPEDITION_STOPS.some(p=>Math.hypot(x-p.x,z-p.z)<clearance+16))continue;
    if(!collision.free({x,z},clearance+1.4)||placed.some(p=>Math.hypot(x-p.x,z-p.z)<clearance+p.clearance+3))continue;
    placed.push({id:`${key}-${++total}`,key,biome,x,z,yaw:+(random()*Math.PI*2).toFixed(3),scale,clearance,groundOffset:-.075});
  }
  if(total!==count)throw new Error(`Only ${total}/${count} clear ${key} placements`);
}
await writeFile(new URL('../shared/region-features.mjs',import.meta.url),'// Shared Earth placements. Cacti stay in the Americas. Original GLBs and measured footprints are unchanged.\nexport const REGION_FEATURES=Object.freeze('+JSON.stringify(placed,null,2)+'.map(Object.freeze));\n');
console.log(JSON.stringify({placed:placed.length,keys:[...keys]}));
