import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { HUNTING } from '../dist/shared/hunting.mjs';
import { inventoryCounts, selectedHuntTarget, huntInteraction, attackReady, approachAnimal } from '../dist/src/hunting-ui.js';
import { orientSpear } from '../dist/src/spear-pose.js';
import { WorldAssets } from '../dist/src/world-assets.js';

test('hunting controls normalize legacy inventory and prioritize harvest or cooking', () => {
  assert.deepEqual(inventoryCounts({wood:2}), {wood:2,stone:0,berry:0,rawMeat:0,cookedMeat:0,obsidian:0,seed:0,water:0});
  const me={x:50,z:52,inventory:{rawMeat:1}},meat={id:'m',phase:'meat',x:50,z:52,meatRemaining:3},state={camp:{x:50,z:50},animals:[meat]};
  assert.deepEqual(huntInteraction(state,me), {action:'harvest',targetId:'m',label:'生肉を採る（残り3個）'});
  assert.equal(huntInteraction({...state,animals:[]},me).action,'cook');
  assert.equal(huntInteraction({...state,animals:[]},{...me,x:80}),null);
  assert.equal(huntInteraction(state,{...me,cookingEndsAt:1000}).action,'cancelCook');
});

test('target selection and approach keep the player outside the animal but in spear reach', () => {
  const me={x:0,z:0,radius:.32},a={id:'a',x:10,z:12,radius:1.9,phase:'alive'},b={id:'b',x:20,z:20,radius:2,phase:'alive'};
  assert.equal(selectedHuntTarget([a,b],me).id,'a');
  assert.equal(selectedHuntTarget([a,b],me,'b').id,'b');
  assert.equal(selectedHuntTarget([a,{...b,phase:'respawning'}],me,'b').id,'a');
  assert.equal(attackReady(me,a),false);
  const point=approachAnimal(me,a),d=Math.hypot(point.x-a.x,point.z-a.z);
  assert.ok(d>a.radius+me.radius);assert.ok(d<a.radius+me.radius+HUNTING.spearReach);
  assert.equal(attackReady({...me,...point},a),true);
  for(const offset of [[0,5],[5,0],[0,-5],[-5,0],[0,0]]){
    const target=approachAnimal({...me,x:a.x+offset[0],z:a.z+offset[1]},a);
    assert.ok(Math.abs(Math.hypot(target.x-a.x,target.z-a.z)-(a.radius+me.radius+.9))<1e-6);
  }
});

test('spear stays at animated grip and aims forward at every character heading', () => {
  const root=new THREE.Group(),grip=new THREE.Bone(),weapon=new THREE.Group();root.add(grip);grip.add(weapon);
  grip.position.set(.3,1.2,.5);grip.rotation.set(.8,-.4,1.1);
  const initial=weapon.quaternion.clone();
  for(const heading of [0,Math.PI/2,Math.PI,-Math.PI/3]){
    root.rotation.y=heading;root.updateMatrixWorld(true);const at=weapon.getWorldPosition(new THREE.Vector3());
    orientSpear(weapon,root,true,initial);root.updateMatrixWorld(true);
    const direction=new THREE.Vector3(0,1,0).applyQuaternion(weapon.getWorldQuaternion(new THREE.Quaternion()));
    const expected=new THREE.Vector3(Math.sin(heading),0,Math.cos(heading));
    assert.ok(direction.distanceTo(expected)<1e-6);assert.ok(weapon.getWorldPosition(new THREE.Vector3()).distanceTo(at)<1e-6);
  }
  orientSpear(weapon,root,false,initial);assert.deepEqual(weapon.quaternion.toArray(),initial.toArray());
});

test('animal death seeks to server phase time, clamps, and resets after respawn', () => {
  const root=new THREE.Group(),joint=new THREE.Bone();joint.name='Body';root.add(joint);
  const clips=['Idle_Loop','Walk_Loop','Death'].map((name,index)=>new THREE.AnimationClip(name,1,[new THREE.NumberKeyframeTrack('Body.position[y]',[0,1],[0,index])]));
  const assets=new WorldAssets();assets.templates.set('test',{gltf:{scene:root,animations:clips},asset:{}});
  const actor=assets.createAnimal('test');actor.play('Walk_Loop');actor.update(.6);actor.sampleOnce('Death',.5);
  assert.equal(actor.name,'Death');assert.ok(Math.abs(actor.root.getObjectByName('Body').position.y-1)<1e-6);
  actor.sampleOnce('Death',3);assert.equal(actor.root.getObjectByName('Body').position.y,2);
  actor.stop();assert.equal(actor.name,null);actor.play('Idle_Loop');actor.update(.1);assert.equal(actor.root.getObjectByName('Body').position.y,0);actor.dispose();
});
