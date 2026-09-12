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
import {nearbyChunks} from '../dist/shared/biomes.mjs';
import {COAST_RUNS,COAST_GRID} from '../dist/shared/paleo-coast-data.mjs?baseline';

test('Earth coordinates round-trip at equator, poles, dateline and the existing camp',()=>{
  for(const [longitude,latitude] of [[-180,90],[180,-90],[0,0],[138,37],[-103,40]]){
    const p=geoToWorld(longitude,latitude),geo=worldToGeo(p.x,p.z);assert.ok(Math.abs(geo.longitude-longitude)<1e-10);assert.ok(Math.abs(geo.latitude-latitude)<1e-10);
  }
  const camp=worldToGeo(50,50);assert.ok(camp.longitude>15&&camp.longitude<25&&camp.latitude>45&&camp.latitude<53);
  assert.equal(WORLD.width,8192);assert.equal(WORLD.depth,4096);assert.equal(EARTH.epochYearsBP,50000);
});
test('archived NOAA base field retains its hash; runtime samples include the explicitly authored gulf',async()=>{
  const meta=JSON.parse(await readFile(new URL('../assets/geography/build.json',import.meta.url))),source=coastTextureData();
  const base=new Uint8Array(COAST_GRID.width*COAST_GRID.height);let cursor=0;
  for(let i=0;i<COAST_RUNS.length;i+=2){base.fill(COAST_RUNS[i+1],cursor,cursor+COAST_RUNS[i]);cursor+=COAST_RUNS[i];}
  assert.equal(createHash('sha256').update(base).digest('hex'),meta.fieldSha256);
  assert.equal(source.data.byteLength,8388608);assert.equal(meta.seaLevelMetres,-68.3);
  for(let z=0;z<source.height;z+=37)for(let x=0;x<source.width;x+=41){const d=coastDistance(source.minX+(x+.5)*source.cell,source.minZ+(z+.5)*source.cell);assert.equal(d,(source.data[z*source.width+x]-128)/4);}
});
test('major continents and exposed Sunda/Sahul shelves retain their geographic positions',()=>{
  for(const [lon,lat] of [[20,49],[-103,40],[-56,-12],[20,5],[90,45],[134,-26],[-42,73],[20,-78],[112,-3],[137,-10]]){const p=geoToWorld(lon,lat);assert.ok(isLand(p.x,p.z),`${lon}, ${lat} should be land`);}
  for(const [lon,lat] of [[-100,0],[-30,0],[80,-30],[0,0],[170,-30]]){const p=geoToWorld(lon,lat);assert.ok(!isLand(p.x,p.z),`${lon}, ${lat} should be ocean`);}
});
test('body sweeps stop on coastlines in multiple continents for people and mammoths',()=>{
  const c=new CollisionWorld([]),source=coastTextureData();let cases=0;
  for(let z=40;z<source.height-40;z+=23)for(let x=40;x<source.width-40;x+=7){
    const start={x:source.minX+(x+.5)*source.cell,z:source.minZ+(z+.5)*source.cell};if(coastDistance(start.x,start.z)<4)continue;
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
test('ocean, island and polar cameras retain a bounded rectangular working set',()=>{
  for(const point of [...EXPEDITION_STOPS,geoToWorld(-140,0),geoToWorld(179,0),geoToWorld(0,-89)]){
    const chunks=nearbyChunks(point.x,point.z,128);assert.ok(chunks.length<=70);assert.ok(chunks.every(c=>c.ix<WORLD.width/WORLD.chunkSize&&c.iz<WORLD.depth/WORLD.chunkSize));
  }
});
test('the vector coastline traces the zero of the distance field inside the atlas, in a bounded time',async()=>{
  const {coastlineContours}=await import('../dist/shared/paleo-geography.mjs');
  const {GULF}=await import('../dist/shared/gulf-region.mjs');
  const minX=Math.min(EARTH.minX,GULF.minX),maxX=Math.max(EARTH.maxX,GULF.maxX),minZ=Math.min(EARTH.minZ,GULF.minZ),maxZ=Math.max(EARTH.maxZ,GULF.maxZ);
  const t=performance.now(),contours=coastlineContours();assert.ok(performance.now()-t<1500);
  assert.ok(contours.length>50,`only ${contours.length} coastlines`);
  let points=0;
  for(const line of contours){
    assert.ok(line.length>=2);
    for(const p of line){
      points++;
      assert.ok(p.x>=minX-2&&p.x<=maxX+2&&p.z>=minZ-2&&p.z<=maxZ+2,`${p.x}, ${p.z} outside the atlas`);
      assert.ok(Math.abs(coastDistance(p.x,p.z))<2,`${p.x}, ${p.z} is ${coastDistance(p.x,p.z)} m from the shore`);
    }
  }
  assert.ok(points>5000,`only ${points} shoreline points`);
  assert.equal(coastlineContours(),contours,'cached per step');
  // The playable camp coast and the authored gulf both have a traced shoreline nearby.
  const near=(x,z,r)=>contours.some(line=>line.some(p=>Math.hypot(p.x-x,p.z-z)<r));
  assert.ok(near(-2000,850,400),'gulf shoreline');
  assert.ok(near(geoToWorld(-5,36).x,geoToWorld(-5,36).z,120),'Gibraltar shoreline');
});
