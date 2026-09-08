import test from 'node:test';
import assert from 'node:assert/strict';
import { CollisionWorld, overlap } from '../dist/shared/collision.mjs';
import { BRIDGE } from '../dist/shared/scenery-layout.mjs';
import { riverX } from '../dist/shared/terrain.mjs';
import { createAnimals, updateAnimals, actorObstacle } from '../dist/shared/animals.mjs';
const box={id:'wall',type:'box',x:10,z:10,hx:1,hz:2,c:1,s:0,height:3};

test('swept movement blocks high-speed tunnelling and slides along a wall', () => {
  const world=new CollisionWorld([box],{river:false});
  const hit=world.move({x:6,z:10},8,0,.32);
  assert.ok(hit.x<=8.6801&&hit.x>8.67);assert.equal(overlap(hit,.32,box),null);
  const slide=world.move({x:8.6,z:8.4},1,1,.32);
  assert.ok(slide.z>9.3);assert.ok(slide.x<=8.6801);
});

test('rotated building corners and moving mammals use the same non-penetrating solver', () => {
  const rotated={...box,c:Math.cos(.7),s:Math.sin(.7)},world=new CollisionWorld([rotated],{river:false});
  const end=world.move({x:6,z:10},9,1,.32);
  assert.equal(overlap(end,.32,rotated),null);
  const empty=new CollisionWorld([],{river:false}),mammoth={type:'circle',x:10,z:10,radius:2.9};
  const human=empty.move({x:4,z:10},10,0,.32,[mammoth]);
  assert.ok(human.x<=6.781);assert.equal(overlap(human,.32,mammoth),null);
});

test('optional impassable river routes over the bridge without corner cutting', () => {
  const world=new CollisionWorld(undefined,{river:true}),start={x:49,z:54},end={x:68,z:43};
  const path=world.path(start,end,.32);assert.ok(path.length>1);
  let previous=start,crossed=false;
  for(const point of path){assert.ok(world.segmentFree(previous,point,.32));if(previous.x<BRIDGE.x&&point.x>=BRIDGE.x)crossed=true;previous=point;}
  assert.ok(crossed);assert.ok(Math.hypot(previous.x-end.x,previous.z-end.z)<.001);
  const river=world.move({x:60,z:52},15,0,.32);assert.ok(river.x<65);
  const nearRail={x:BRIDGE.x,z:BRIDGE.z};const rail=world.move(nearRail,0,5,.32);
  assert.ok(Math.hypot(rail.x-nearRail.x,rail.z-nearRail.z)<1.1,'Walking into a rail cannot teleport to the bank');
});

test('default river allows walking and mounted movement in both directions and direct click routes', () => {
  // This fixture tests the ford independently of the new Baltic coastline.
  const world=new CollisionWorld(undefined,{coast:false});
  for(const z of [-25,0,52,110,150])for(const radius of [.24,.32,2.9]) {
    const x=riverX(z),west={x:x-4,z},east={x:x+4,z};
    assert.ok(world.free({x,z},radius),`river centre at ${z}, radius ${radius}`);
    for(const [start,end] of [[west,east],[east,west]]) {
      assert.deepEqual(world.path(start,end,radius),[end]);
      const moved=world.move(start,end.x-start.x,0,radius);
      assert.ok(Math.hypot(moved.x-end.x,moved.z-end.z)<.001);
    }
  }
  const nearRail={x:BRIDGE.x,z:BRIDGE.z},rail=world.move(nearRail,0,5,.32);
  assert.ok(Math.hypot(rail.x-nearRail.x,rail.z-nearRail.z)<1.1,'bridge rails still block movement');
});

test('resource colliders disappear with depleted resources and return on regeneration', () => {
  let amount=1;const world=new CollisionWorld([{...box,resourceId:'stone'}],{river:false,active:()=>amount>0});
  assert.equal(world.free({x:10,z:10},.32),false);amount=0;assert.equal(world.free({x:10,z:10},.32),true);
  amount=1;assert.equal(world.free({x:10,z:10},.32),false);
});

test('mammoths spawn clear of objects and remain clear while roaming and grazing', () => {
  const collision=new CollisionWorld(),animals=createAnimals(collision),room={collision,animals,players:new Map()};
  let walked=false,grazed=false;
  for(let i=0;i<900;i++) {
    updateAnimals(room,.05);
    for(const animal of animals){assert.ok(collision.free(animal,animal.radius,animals.filter(a=>a!==animal).map(actorObstacle)));walked ||= animal.clip==='Walk_Loop';grazed ||= animal.clip==='Graze_Loop';}
  }
  assert.ok(walked&&grazed);
});
