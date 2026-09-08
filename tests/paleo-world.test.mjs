import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {EARTH,geoToWorld,worldToGeo,isLand,coastDistance,coastTextureData,EXPEDITION_STOPS,geographicBiome,landmassAt} from '../dist/shared/paleo-geography.mjs';
import {WORLD,INITIAL_RESOURCES} from '../dist/shared/world.mjs';
import {CollisionWorld,staticObstacles} from '../dist/shared/collision.mjs';
import {SCENERY} from '../dist/shared/scenery-layout.mjs';
import {LANDMARKS} from '../dist/shared/landmarks.mjs';
import {REGION_FEATURES} from '../dist/shared/region-features.mjs';
import {takeExpedition} from '../dist/shared/expeditions.mjs';
import {nearbyChunks} from '../dist/shared/biomes.mjs';

test('Earth coordinates round-trip at equator, poles, dateline and the existing camp',()=>{
  for(const [longitude,latitude] of [[-180,90],[180,-90],[0,0],[138,37],[-103,40]]){
    const p=geoToWorld(longitude,latitude),geo=worldToGeo(p.x,p.z);assert.ok(Math.abs(geo.longitude-longitude)<1e-10);assert.ok(Math.abs(geo.latitude-latitude)<1e-10);
  }
  const camp=worldToGeo(50,50);assert.ok(camp.longitude>15&&camp.longitude<25&&camp.latitude>45&&camp.latitude<53);
  assert.equal(WORLD.width,4096);assert.equal(WORLD.depth,2048);assert.equal(EARTH.epochYearsBP,50000);
});
test('runtime shoreline is the exact field built from the archived NOAA input',async()=>{
  const meta=JSON.parse(await readFile(new URL('../assets/geography/build.json',import.meta.url))),source=coastTextureData();
  assert.equal(createHash('sha256').update(source.data).digest('hex'),meta.fieldSha256);
  assert.equal(source.data.byteLength,2097152);assert.equal(meta.seaLevelMetres,-68.3);
  for(let z=0;z<source.height;z+=37)for(let x=0;x<source.width;x+=41){const d=coastDistance(EARTH.minX+(x+.5)*2,EARTH.minZ+(z+.5)*2);assert.equal(d,(source.data[z*source.width+x]-128)/4);}
});
test('major continents and exposed Sunda/Sahul shelves retain their geographic positions',()=>{
  for(const [lon,lat] of [[20,49],[-103,40],[-56,-12],[20,5],[90,45],[134,-26],[-42,73],[20,-78],[112,-3],[137,-10]]){const p=geoToWorld(lon,lat);assert.ok(isLand(p.x,p.z),`${lon}, ${lat} should be land`);}
  for(const [lon,lat] of [[-140,0],[-30,0],[80,-30],[0,0],[170,-30]]){const p=geoToWorld(lon,lat);assert.ok(!isLand(p.x,p.z),`${lon}, ${lat} should be ocean`);}
});
test('body sweeps stop on coastlines in multiple continents for people and mammoths',()=>{
  const c=new CollisionWorld([]),source=coastTextureData();let cases=0;
  for(let z=40;z<source.height-40;z+=23)for(let x=40;x<source.width-40;x+=7){
    const start={x:EARTH.minX+(x+.5)*2,z:EARTH.minZ+(z+.5)*2};if(coastDistance(start.x,start.z)<4)continue;
    const sea={x:start.x+12,z:start.z};if(isLand(sea.x,sea.z))continue;
    for(const radius of [.24,.32,2.95]){assert.ok(c.free(start,radius));const end=c.move(start,12,0,radius);assert.ok(c.free(end,radius));assert.ok(end.x<sea.x-1);}
    cases++;
  }
  assert.ok(cases>25,`Only ${cases} shoreline sweeps`);
});
test('water and disconnected-continent clicks reject promptly and cannot form a walk route',()=>{
  const c=new CollisionWorld(),camp=EXPEDITION_STOPS[0],green=EXPEDITION_STOPS.find(p=>p.id==='greenland');
  assert.notEqual(landmassAt(camp.x,camp.z),landmassAt(green.x,green.z));
  const t=performance.now();assert.deepEqual(c.path(camp,green,.32),[]);assert.ok(performance.now()-t<100);
  assert.deepEqual(c.path(camp,geoToWorld(-30,0),.32),[]);
});
test('every exploration camp and resource is dry; measured landmark and feature footprints stay on land',()=>{
  const c=new CollisionWorld();
  for(const stop of EXPEDITION_STOPS){assert.ok(c.free(stop,.32),stop.id);assert.ok(coastDistance(stop.x,stop.z)>12);}
  for(const p of INITIAL_RESOURCES)assert.ok(isLand(p.x,p.z,2),p.id);
  for(const category of ['trees','rocks','tents','props','fires'])for(const p of SCENERY[category])assert.ok(isLand(p.x,p.z),category);
  for(const o of staticObstacles().filter(o=>o.landmarkId))assert.ok(isLand(o.x,o.z),`${o.landmarkId}: footprint is at sea`);
  assert.ok(LANDMARKS.length>=10);assert.equal(REGION_FEATURES.filter(p=>p.key==='desert-cactus').length,48);
  for(const p of REGION_FEATURES.filter(p=>p.key==='desert-cactus'))assert.ok(worldToGeo(p.x,p.z).longitude< -90);
});
test('thirteen expeditions retain inventory and progress, cancel incompatible actions and select five distinct arrivals',()=>{
  const c=new CollisionWorld(),room={collision:c,players:new Map(),animals:[],enemies:[],projectiles:[]};
  for(let i=0;i<5;i++)room.players.set(String(i),{id:String(i),x:49+i,z:57,radius:.32,inventory:{wood:12,rawMeat:3},tool:true,gathered:19,energy:63,attackSequence:2});
  let now=1000;
  for(const stop of EXPEDITION_STOPS){now+=4000;
    for(const p of room.players.values()){
      p.cookingEndsAt=now+3000;p.pendingStrike={impactAt:now+200};p.navigationGoal={x:50,z:60};
      const result=takeExpedition(room,p,stop.id,now);assert.equal(result.ok,true,stop.id);
      assert.deepEqual(p.inventory,{wood:12,rawMeat:3});assert.equal(p.tool,true);assert.equal(p.gathered,19);assert.equal(p.energy,63);
      assert.equal(p.cookingEndsAt,0);assert.equal(p.pendingStrike,null);assert.equal(p.navigationGoal,null);assert.ok(c.free(p,p.radius));
    }
    const people=[...room.players.values()];for(let i=0;i<5;i++)for(let j=i+1;j<5;j++)assert.ok(Math.hypot(people[i].x-people[j].x,people[i].z-people[j].z)>=.64);
  }
});
test('expeditions refuse forged coordinates, mounted players, downed players and cooldown spam',()=>{
  const room={collision:new CollisionWorld(),players:new Map(),animals:[],enemies:[]},p={id:'a',x:49,z:57,radius:.32};room.players.set(p.id,p);
  for(const id of [null,'forged',{x:30,z:40},'__proto__'])assert.equal(takeExpedition(room,p,id,1000).ok,false);
  p.mountId='mammoth-1';assert.equal(takeExpedition(room,p,'snow',1000).ok,false);p.mountId=null;
  p.downedUntil=2000;assert.equal(takeExpedition(room,p,'snow',1000).ok,false);p.downedUntil=0;
  assert.equal(takeExpedition(room,p,'snow',1000).ok,true);assert.equal(takeExpedition(room,p,'desert',1100).ok,false);
  assert.equal(geographicBiome(p.x,p.z),'snow');
});
test('ocean, island and polar cameras retain a bounded rectangular working set',()=>{
  for(const point of [...EXPEDITION_STOPS,geoToWorld(-140,0),geoToWorld(179,0),geoToWorld(0,-89)]){
    const chunks=nearbyChunks(point.x,point.z,128);assert.ok(chunks.length<=70);assert.ok(chunks.every(c=>c.ix<128&&c.iz<64));
  }
});
