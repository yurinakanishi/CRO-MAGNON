import test from 'node:test';
import assert from 'node:assert/strict';
import {measuredWalkSurface} from '../shared/measured-walk-surface.mjs';
import {CollisionWorld} from '../shared/collision.mjs';
import {startAttack,resolveAttack,updateProjectiles} from '../shared/combat.mjs';

test('measured floors use the same rotated coordinates for height and body clearance',()=>{
  const surface=measuredWalkSurface({step:1,minX:0,minZ:0,nx:3,nz:3,heights:[0,0,0,0,2,null,0,2,null]},{x:10,z:20,yaw:Math.PI/2,scale:2});
  const floor=surface.world(1.5,1.5),wall=surface.world(2.5,1.5);
  assert.equal(surface.height(floor.x,floor.z),4);
  assert.equal(surface.height(wall.x,wall.z),null);
  assert.equal(surface.free(wall.x,wall.z,.32),false);
  assert.equal(surface.free(floor.x,floor.z,.32),true);
  assert.equal(surface.height(-100,-100),undefined);
});

test('measured stairs permit gradual ascent while a floor-height discontinuity blocks movement',()=>{
  const surface=measuredWalkSurface({step:.5,minX:0,minZ:0,nx:8,nz:1,heights:[0,.2,.4,.6,.8,5,5,null]},{x:0,z:0,yaw:0});
  for(let i=0;i<4;i++)assert.equal(surface.transition({x:i*.5+.25,z:.25},{x:(i+1)*.5+.25,z:.25}),true);
  assert.equal(surface.transition({x:2.25,z:.25},{x:2.75,z:.25}),false);
  assert.equal(surface.free(3.3,.25,.32),false,'Body may not hang through a wall cell');
});

test('authoritative movement and path planning take the stairs instead of crossing a terrace wall',()=>{
  const nx=20,nz=20,heights=[];
  for(let z=0;z<nz;z++)for(let x=0;x<nx;x++)heights.push(x<10?0:z>=7&&z<=12?Math.min(3,(x-9)*.4):3);
  const surface=measuredWalkSurface({step:.5,minX:0,minZ:0,nx,nz,heights},{x:20,z:20,yaw:0});
  const collision=new CollisionWorld([],{coast:false,walkSurfaces:[surface]});
  const start={x:23,z:22},goal={x:29,z:22};
  assert.equal(collision.segmentFree(start,goal,.2),false);
  const route=collision.path(start,goal,.2);assert.ok(route.length>1);
  assert.ok(route.some(p=>p.z>=23.5),'Route passes through the staircase');
  let previous=start;for(const point of route){assert.ok(collision.segmentFree(previous,point,.2));previous=point;}
  const stopped=collision.move(start,4,0,.2);assert.ok(stopped.x<25,'Movement cannot climb the vertical terrace face');
});

test('melee and magic cannot damage an enemy on a different castle floor',()=>{
  const heights=Array.from({length:100},(_,i)=>i%10<5?0:4);
  const surface=measuredWalkSurface({step:.5,minX:0,minZ:0,nx:10,nz:10,heights},{x:20,z:20,yaw:0});
  for(const species of ['cat','bear']){
    const collision=new CollisionWorld([],{coast:false,walkSurfaces:[surface]});
    const player={id:'p',species,x:22,z:22,radius:.28,facing:Math.PI/2,energy:100};
    const enemy={id:'e',x:23,z:22,radius:.4,health:75,hostile:true,phase:'alive'};
    const room={players:new Map([[player.id,player]]),animals:[],enemies:[enemy],collision};
    assert.equal(startAttack(room,player,{},1000).accepted,true);resolveAttack(room,player,1500);
    updateProjectiles(room,2000);assert.equal(enemy.health,75);
  }
});
