import test from 'node:test';
import assert from 'node:assert/strict';
import { CollisionWorld, overlap } from '../shared/collision.mjs';
import { createAnimals, updateAnimals } from '../shared/animals.mjs';
import { RIDING, handleRidingAction, dismountPoint, releaseRider, mountedAnimal } from '../shared/riding.mjs';
import { startAttack, damageableTargets } from '../shared/combat.mjs';
import { planNavigation } from '../shared/navigation.mjs';

function fixture(obstacles=[]) {
  const collision=new CollisionWorld(obstacles,{river:false}),animals=createAnimals(collision,0),animal=animals[0];
  Object.assign(animal,{x:0,z:0,home:{x:0,z:0},nextRoam:1e8});
  const player={id:'rider',species:'cat',gender:'female',x:animal.radius+.5,z:0,radius:.32,energy:88,inventory:{rawMeat:2},path:[]};
  return {collision,animals,players:new Map([[player.id,player]]),enemies:[],player,animal};
}
const ride=(room,p=room.player,targetId=room.animal.id,now=1000)=>handleRidingAction(room,p,{action:'ride',targetId},now);
test('mount selection checks distance, walls, alive state, occupancy and action windup atomically',()=>{
  const r=fixture(),p=r.player,a=r.animal;
  p.x=30;assert.equal(ride(r).changed,false);p.x=a.radius+.5;
  a.phase='meat';assert.equal(ride(r).changed,false);a.phase='alive';
  a.hitUntil=1200;assert.equal(ride(r).changed,false);a.hitUntil=0;
  p.attackSequence=1;p.attackAt=950;assert.equal(ride(r).changed,false);p.attackAt=0;
  const other={...p,id:'other'};r.players.set(other.id,other);
  assert.equal(ride(r).changed,true);assert.equal(ride(r,other).changed,false);
  assert.equal(a.riderId,p.id);assert.equal(p.mountId,a.id);assert.equal(p.x,a.x);
  const w=fixture([{id:'wall',type:'box',x:1.6,z:0,hx:.15,hz:5,c:1,s:0,height:3}]);assert.equal(ride(w).changed,false);
});
test('rider and mount move together, face displacement, run faster, stop after input timeout',()=>{
  const r=fixture();ride(r);const a=r.animal,p=r.player;
  a.dx=1;a.dz=0;a.lastInput=1100;updateAnimals(r,.1,1100);
  assert.ok(Math.abs(a.x-RIDING.walkSpeed*.1)<1e-6);assert.equal(p.x,a.x);assert.equal(p.facing,Math.PI/2);assert.equal(a.clip,'Walk_Loop');
  a.runningRequested=true;a.lastInput=1200;updateAnimals(r,.1,1200);
  assert.equal(a.clip,'Run_Loop');assert.ok(Math.abs(a.speed-RIDING.runSpeed)<1e-6);assert.equal(p.running,true);
  const x=a.x;updateAnimals(r,.1,1800);assert.equal(a.x,x);assert.equal(p.moving,false);assert.equal(a.clip,'Idle_Loop');
});
test('body-sized sweep blocks buildings and other players without pushing the rider out',()=>{
  const wall={id:'wall',type:'box',x:8,z:0,hx:1,hz:8,c:1,s:0,height:3},r=fixture([wall]);ride(r);
  const a=r.animal;a.dx=1;a.runningRequested=true;
  for(let i=0;i<100;i++){a.lastInput=2000+i*100;updateAnimals(r,.1,a.lastInput);assert.equal(overlap(a,a.radius,wall),null);assert.equal(r.player.x,a.x);}
  assert.ok(a.x<=7-a.radius+.001);
  const empty=fixture();ride(empty);const bystander={id:'nearby',x:6,z:0,radius:.32};empty.players.set(bystander.id,bystander);empty.animal.dx=1;empty.animal.runningRequested=true;
  for(let i=0;i<100;i++){empty.animal.lastInput=3000+i*100;updateAnimals(empty,.1,empty.animal.lastInput);assert.equal(overlap(empty.animal,empty.animal.radius,{...bystander,type:'circle'}),null);}
});
test('dismount is outside the animal, collision-free, stops movement and preserves inventory',()=>{
  const r=fixture();ride(r);r.animal.dx=1;r.animal.runningRequested=true;
  const result=ride(r);assert.equal(result.changed,true);assert.equal(r.player.mountId,null);assert.equal(r.animal.riderId,null);assert.equal(r.animal.dx,0);
  assert.ok(Math.hypot(r.player.x-r.animal.x,r.player.z-r.animal.z)>r.animal.radius+r.player.radius);
  assert.deepEqual(r.player.inventory,{rawMeat:2});assert.equal(r.player.energy,88);
});
test('blocked exits keep occupancy; losing the rider releases the mammoth safely',()=>{
  const r=fixture();ride(r);const free=r.collision.free;r.collision.free=()=>false;
  assert.equal(dismountPoint(r,r.player,r.animal),null);assert.equal(ride(r).changed,false);assert.equal(r.animal.riderId,r.player.id);
  r.collision.free=free;r.animal.dx=1;r.players.delete(r.player.id);updateAnimals(r,.1,2000);assert.equal(r.animal.riderId,null);assert.equal(r.animal.dx,0);
});
test('occupied animals cannot be hunted; dismount restores free attacks and ordinary hunting',()=>{
  const r=fixture();ride(r);assert.equal(startAttack(r,r.player,{},2000).reason,'mounted');assert.ok(!damageableTargets(r).some(t=>t.target===r.animal));
  ride(r);assert.equal(startAttack(r,r.player,{},2000).accepted,true);assert.ok(damageableTargets(r).some(t=>t.target===r.animal));
});
test('disconnect releases control and click navigation uses the mount radius',()=>{
  const r=fixture();ride(r);assert.equal(mountedAnimal(r,r.player),r.animal);
  assert.ok(planNavigation(r.animal,{x:-12,z:0},r.collision,[],2000));
  for(let i=0;i<200;i++)updateAnimals(r,.1,2000+i*100);
  assert.ok(Math.abs(r.animal.x+12)<.1);assert.equal(r.player.x,r.animal.x);
  releaseRider(r,r.player);assert.equal(mountedAnimal(r,r.player),undefined);assert.equal(r.animal.target,null);assert.equal(r.animal.home.x,r.animal.x);
});
