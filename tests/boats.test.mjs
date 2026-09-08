import test from 'node:test';
import assert from 'node:assert/strict';
import { CollisionWorld } from '../dist/shared/collision.mjs';
import { BOATING,initializeBoats,handleBoatAction,updateBoats,releaseBoat,launchPoint,waterBodyFree,landingPoint } from '../dist/shared/boats.mjs';
const shore={x:21,z:125};
function fixture(){const p={id:'p',species:'cro',gender:'female',...shore,radius:.32,inventory:{wood:24},path:[],energy:100};const r={collision:new CollisionWorld(),players:new Map([[p.id,p]]),animals:[],enemies:[],p};initializeBoats(r);return r;}
const act=(r,action,p=r.p,targetId)=>handleBoatAction(r,p,{action,targetId},10000);
test('building consumes wood only after capacity, coast and free launch space pass',()=>{
  const r=fixture();r.p.inventory.wood=11;assert.equal(act(r,'craftBoat').changed,false);assert.equal(r.p.inventory.wood,11);
  r.p.inventory.wood=24;r.p.x=50;r.p.z=50;assert.equal(act(r,'craftBoat').changed,false);assert.equal(r.p.inventory.wood,24);
  Object.assign(r.p,shore);assert.equal(act(r,'craftBoat').changed,true);assert.equal(r.p.inventory.wood,12);assert.equal(r.boats.length,1);
  assert.ok(waterBodyFree(r.boats[0].x,r.boats[0].z,BOATING.radius));
  r.boats=Array.from({length:5},(_,i)=>({...r.boats[0],id:`boat-${i+1}`}));assert.equal(act(r,'craftBoat').changed,false);assert.equal(r.p.inventory.wood,12);
});
test('boarding is exclusive, validates range and action conflicts, and cannot fabricate IDs',()=>{
  const r=fixture();act(r,'craftBoat');assert.equal(act(r,'boardBoat',r.p,'fake').changed,false);
  r.p.cookingEndsAt=1;assert.equal(act(r,'boardBoat').changed,false);r.p.cookingEndsAt=0;
  r.p.mountId='mammoth';assert.equal(act(r,'boardBoat').changed,false);r.p.mountId=null;
  const other={...r.p,id:'other'};r.players.set(other.id,other);
  assert.equal(act(r,'boardBoat').changed,true);assert.equal(act(r,'boardBoat',other).changed,false);
  assert.equal(r.p.boatId,r.boats[0].id);assert.equal(r.boats[0].riderId,r.p.id);
});
test('hull sweeps stay at sea, rider stays synchronized, stale input stops and offshore exit fails',()=>{
  const r=fixture();act(r,'craftBoat');act(r,'boardBoat');const b=r.boats[0];
  b.dx=0;b.dz=1;b.runningRequested=true;
  for(let i=0;i<14;i++){b.lastInput=11000+i*100;updateBoats(r,.1,b.lastInput);assert.ok(waterBodyFree(b.x,b.z,b.radius));assert.equal(r.p.x,b.x);assert.equal(r.p.z,b.z);}
  const before={x:b.x,z:b.z};updateBoats(r,.1,b.lastInput+1000);assert.equal(b.x,before.x);assert.equal(b.z,before.z);
  assert.equal(landingPoint(r,r.p,b),null);assert.equal(act(r,'boardBoat').changed,false);assert.equal(r.p.boatId,b.id);
  b.dz=-1;for(let i=0;i<140;i++){b.lastInput=21000+i*100;updateBoats(r,.1,b.lastInput);assert.ok(waterBodyFree(b.x,b.z,b.radius));}
  assert.ok(landingPoint(r,r.p,b));assert.equal(act(r,'boardBoat').changed,true);assert.ok(r.collision.free(r.p,r.p.radius));
});
test('disconnect returns the boat and player to the embarkation, keeps materials and clears input',()=>{
  const r=fixture();act(r,'craftBoat');act(r,'boardBoat');const b=r.boats[0],mooring={...b.mooring};b.dz=1;b.lastInput=20000;updateBoats(r,.1,20000);
  releaseBoat(r,r.p);assert.equal(r.p.boatId,null);assert.equal(b.riderId,null);assert.equal(b.dx,0);assert.equal(b.dz,0);assert.equal(r.p.inventory.wood,12);assert.equal(r.p.x,shore.x);assert.equal(b.x,mooring.x);assert.equal(b.z,mooring.z);
});
test('land cannot be targeted by sea navigation; blocked launch cannot consume materials',()=>{
  const r=fixture();const point=launchPoint(r,r.p);assert.deepEqual(r.seaCollision.path(point,shore,BOATING.radius),[]);
  r.seaCollision.free=()=>false;assert.equal(act(r,'craftBoat').changed,false);assert.equal(r.p.inventory.wood,24);
});
test('five moving hulls cannot overlap or push riders apart, including competing paths',()=>{
  const r=fixture();r.players.clear();r.boats=[];
  for(let i=0;i<5;i++){
    const x=-600+i*6,z=300;assert.ok(waterBodyFree(x,z,BOATING.radius));
    const b={id:`boat-${i}`,x,z,radius:2,facing:0,riderId:`p${i}`,path:[],dx:i%2?-1:1,dz:0,speed:0,runningRequested:true,mooring:{x,z},shore:{...shore}};
    r.boats.push(b);r.players.set(b.riderId,{id:b.riderId,boatId:b.id,...shore});
  }
  for(let t=0;t<200;t++){
    for(const b of r.boats)b.lastInput=20000+t*100;
    updateBoats(r,.1,20000+t*100);
    for(let i=0;i<5;i++){const b=r.boats[i],p=r.players.get(b.riderId);assert.equal(p.x,b.x);assert.equal(p.z,b.z);for(let j=i+1;j<5;j++)assert.ok(Math.hypot(b.x-r.boats[j].x,b.z-r.boats[j].z)>=4-.0001);}
  }
});
