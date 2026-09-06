import { WORLD, INITIAL_RESOURCES } from './world.mjs';
import { riverX, riverHalfWidth } from './terrain.mjs';
import { biomeAt, biomeWeights, chunkDescription, JOURNEY_STOPS, roadDistance } from './biomes.mjs';
import { nearLandmark } from './landmarks.mjs';
// Body-sized animals need a continuous clearing, not just a free spawn point.
// Existing harvestable resources sit outside the five-metre roaming footprint.
export const HUNTING_GROUNDS = Object.freeze([
  Object.freeze({ x: 25, z: 21, radius: 10, roamRadius: 5 }),
  Object.freeze({ x: 24, z: 85, radius: 10, roamRadius: 5 }),
]);
export const ENEMY_GROUNDS = Object.freeze([Object.freeze({ id: 'crow-shaman-1', x: 45, z: 16, radius: 5, roamRadius: 3.2 })]);
const inHuntingGround = (x, z, margin = 0) => HUNTING_GROUNDS.some(ground => Math.hypot(x - ground.x, z - ground.z) < ground.radius + margin);
const inEnemyGround = (x, z, margin = 0) => ENEMY_GROUNDS.some(ground => Math.hypot(x - ground.x, z - ground.z) < ground.radius + margin);
export function seededRandom(seed) { return () => { seed|=0;seed=(seed+0x6d2b79f5)|0;let t=Math.imul(seed^(seed>>>15),1|seed);t=(t+Math.imul(t^(t>>>7),61|t))^t;return ((t^(t>>>14))>>>0)/4294967296; }; }
const TAU=Math.PI*2;
function layout() {
  const rng=seededRandom(404),trees=[],grass=[],rocks=[],ridges=[];
  for(let i=0;i<840;i++) {
    const x=-35+rng()*170,z=-35+rng()*170;
    if(Math.hypot(x-50,z-50)<14||Math.hypot(x-70,z-41)<7||Math.abs(x-riverX(z))<5.8||Math.abs(x-49-Math.sin(z*.16)*2)<2.7||(x>43&&x<80&&Math.abs(z-43.5)<2.8))continue;
    if(INITIAL_RESOURCES.some(r=>Math.hypot(r.x-x,r.z-z)<2))continue;
    const height=6+rng()*7,width=.75+rng()*.5,yaw=rng()*TAU;
    if(inHuntingGround(x,z,1.5)||inEnemyGround(x,z,1.5))continue;
    trees.push({key:'valley-pine',x,z,height,yaw,scale:[width*height/10,height/10,width*height/10]});
  }
  for(let i=0;i<13500;i++) {
    const x=rng()*115-7,z=rng()*115-7;
    if(Math.hypot(x-50,z-50)<10||Math.hypot(x-70,z-41)<5||Math.abs(x-riverX(z))<3.4||Math.abs(x-49-Math.sin(z*.16)*2)<1.8||(x>45&&x<78&&Math.abs(z-43.5)<1.9))continue;
    const scale=.65+rng()*.65;grass.push({x,z,scale,height:.55*scale,yaw:rng()*TAU});
  }
  for(let i=0;i<65;i++) {
    const x=rng()*140-20,z=rng()*140-20;
    if(Math.hypot(x-50,z-50)<16||Math.hypot(x-70,z-41)<7||Math.abs(x-riverX(z))<5)continue;
    const scale=(.4+rng()*2.6)/1.7,yaw=rng()*TAU;
    if(inHuntingGround(x,z,3.5)||inEnemyGround(x,z,3.5))continue;
    rocks.push({key:'valley-boulder',x,z,yaw,scale});
  }
  // Remove the old enclosing ring of giant rocks. Outlying regions are physically
  // connected, with deterministic colliders shared by server and client.
  const distant=seededRandom(902107);
  for(let i=0;i<6500;i++) {
    const x=WORLD.minX+12+distant()*(WORLD.size-24),z=WORLD.minZ+12+distant()*(WORLD.size-24);
    if(x>-36&&x<136&&z>-36&&z<136)continue;
    if(nearLandmark(x,z,2))continue;
    const biome=biomeAt(x,z),roll=distant();
    if(roadDistance(x,z)<4||JOURNEY_STOPS.some(stop=>Math.hypot(x-stop.x,z-stop.z)<12))continue;
    if(INITIAL_RESOURCES.some(r=>Math.hypot(x-r.x,z-r.z)<3))continue;
    if(riverHalfWidth(z)>.7&&Math.abs(x-riverX(z))<6)continue;
    if(biome.id==='grassland'&&roll<.76||biome.id==='snow'&&roll<.52) {
      const height=5+distant()*7,width=.75+distant()*.45;
      trees.push({key:'valley-pine',x,z,height,yaw:distant()*TAU,scale:[width*height/10,height/10,width*height/10],biome:biome.id});
    } else if(roll>.88) {
      const scale=.35+distant()*1.6;
      rocks.push({key:'valley-boulder',x,z,yaw:distant()*TAU,scale,biome:biome.id});
    }
  }
  // Sparse boundary massifs use the existing reconstructed rock, with gaps.
  for(let i=0;i<40;i++) {
    const side=i%4,t=(i/4+.35)/10,height=7+rng()*11;
    const x=side===0?WORLD.minX+10:side===1?WORLD.maxX-10:WORLD.minX+t*WORLD.size;
    const z=side===2?WORLD.minZ+10:side===3?WORLD.maxZ-10:WORLD.minZ+t*WORLD.size;
    ridges.push({key:'valley-boulder',x,z,yaw:rng()*TAU,scale:[height*.6,height/1.7,height*.5],biome:biomeAt(x,z).id});
  }
  const tents=[[45,46,.4,1],[54.5,44,-.55,.85],[54,55,-2,.65],[73,37,-.7,.85]].map(([x,z,yaw,scale])=>({key:'hide-tent',x,z,yaw,scale}));
  const props=[{key:'drying-rack',x:55.8,z:50,yaw:0,scale:1},{key:'firewood-pile',x:47,z:49,yaw:0,scale:1.25}];
  const fires=[{key:'stone-firepit',x:50,z:50,yaw:0,scale:1},{key:'stone-firepit',x:72,z:43,yaw:0,scale:.65}];
  for(const stop of JOURNEY_STOPS.filter(s=>s.id!=='grassland')) {
    tents.push({key:'hide-tent',x:stop.x-6,z:stop.z-5,yaw:.55,scale:.85});
    fires.push({key:'stone-firepit',id:`fire-${stop.id}`,x:stop.x+2,z:stop.z-1,yaw:0,scale:.8});
  }
  const animals=HUNTING_GROUNDS.map((ground,index)=>({id:`mammoth-${index+1}`,x:ground.x,z:ground.z,scale:index? .76:1,roamRadius:ground.roamRadius}));
  return {trees,grass,rocks,ridges,tents,props,fires,animals};
}
// Renderer and authoritative server use precisely the same placements and scales.
export const SCENERY=layout();
export function grassForChunk(ix,iz) {
  const chunk=chunkDescription(ix,iz),rng=seededRandom(Math.imul(ix+31,73856093)^Math.imul(iz+31,19349663)),grass=[];
  for(let i=0;i<250;i++) {
    const x=chunk.x+(rng()-.5)*32,z=chunk.z+(rng()-.5)*32;
    if(x>=-7&&x<=108&&z>=-7&&z<=108)continue;
    const weight=biomeWeights(x,z)[0];
    if(nearLandmark(x,z,1))continue;
    if(rng()>weight||roadDistance(x,z)<1.5||(riverHalfWidth(z)>.7&&Math.abs(x-riverX(z))<4))continue;
    const scale=.6+rng()*.65;grass.push({x,z,scale,height:.55*scale,yaw:rng()*TAU});
  }
  return grass;
}
export const BRIDGE={x:riverX(43.5),z:43.5,minX:-5.121252209981283,maxX:4.988082171758016,minZ:-1.2622603230953215,maxZ:1.3524676167488099};
