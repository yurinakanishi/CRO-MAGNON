import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {SpellEffects} from '../dist/src/spell-effects.js';

test('spell starts between the hands and cannot draw a trail behind them in any facing',()=>{
 for(const facing of [0,Math.PI/2,Math.PI,Math.PI*1.5,.65]){
  const scene=new THREE.Scene(),effects=new SpellEffects(scene),model=new THREE.Group();
  const left=new THREE.Object3D(),right=new THREE.Object3D();left.position.set(-.10,.41,.16);right.position.set(.06,.40,.14);model.add(left,right);model.position.set(20,0,30);model.rotation.y=facing;model.updateMatrixWorld(true);
  const hand=new THREE.Vector3(),other=new THREE.Vector3();left.getWorldPosition(hand);right.getWorldPosition(other);hand.add(other).multiplyScalar(.5);
  const dx=Math.sin(facing),dz=Math.cos(facing),orb={id:'mage:1',ownerId:'mage',x:20,z:30,dx,dz,travelled:0,elevation:0};
  const state={projectiles:[orb]},players=new Map([['mage',{state:{species:'bear'},model,gripLeft:left,gripRight:right}]]);
  effects.update(state,players,1000,1/60,960);
  assert.equal(effects.count,1,'No pre-existing tail on the release frame');
  assert.ok(new THREE.Vector3(...effects.xyz.slice(0,3)).distanceTo(hand)<1e-5,'Launch core must coincide with hand midpoint');
  let previousForward=0;
  for(let frame=1;frame<=40;frame++){
   if(frame%3===0){orb.travelled=frame/60*7;orb.x=20+dx*orb.travelled;orb.z=30+dz*orb.travelled;}
   const before=structuredClone(orb);effects.update(state,players,1000+frame/60*1000,1/60,960);assert.deepEqual(orb,before,'Rendering must preserve server collision state');
   const forward=(effects.xyz[0]-hand.x)*dx+(effects.xyz[2]-hand.z)*dz;assert.ok(forward>=previousForward-1e-5,'Head must not move back into the caster');previousForward=forward;
   for(let i=0;i<effects.count;i++){const along=(effects.xyz[i*3]-hand.x)*dx+(effects.xyz[i*3+2]-hand.z)*dz;assert.ok(along>=-1e-5,'Trail must stay in front of the release point');assert.ok(along<=forward+1e-5,'Trail must stay behind the head');}
  }
  assert.equal(effects.count,10,'Full tail appears only after enough flight');effects.dispose();
 }
});

test('late projectile snapshots do not replay a cast at the hands',()=>{
 const effects=new SpellEffects(new THREE.Scene()),orb={id:'late',ownerId:'far',x:0,z:3.5,dx:0,dz:1,travelled:3.5,elevation:0};
 effects.update({projectiles:[orb]},new Map(),2000,1/60,960);
 assert.ok(Math.abs(effects.xyz[2]-3.5)<1e-5);assert.equal(effects.count,10);effects.dispose();
});
