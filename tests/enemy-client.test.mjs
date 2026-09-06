import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ENEMY_CLIPS, enemyAnimationState, requireEnemyClips, playerDamageEvent, playerRecovered } from '../src/enemy-state.js';
import { selectedCombatTarget, approachAnimal, approachEnemyGround, attackReady, huntInteraction } from '../src/hunting-ui.js';
import { canStartAttack } from '../src/combat-input.js';
import { WorldAssets } from '../src/world-assets.js';
import { FrameClock } from '../src/frame-clock.js';

test('hostile threat replaces a distant mammoth selection without targeting friendly NPCs', () => {
  const player={id:'p',x:0,z:0,radius:.32},animal={id:'m',x:20,z:0,radius:1.9,phase:'alive'};
  const enemy={id:'e',hostile:true,x:6,z:0,radius:.48,phase:'alive'};
  const state={animals:[animal],enemies:[{id:'npc',hostile:false,x:1,z:0,phase:'alive'},enemy]};
  assert.equal(selectedCombatTarget(state,player,'m'),enemy);
  assert.equal(selectedCombatTarget({...state,enemies:[{...enemy,phase:'respawning'}]},player,'e'),animal);
  const dead={...enemy,phase:'dead'};
  assert.equal(selectedCombatTarget({...state,enemies:[dead]},player,'e'),dead);
  const point=approachAnimal(player,enemy);
  assert.ok(Math.hypot(point.x-enemy.x,point.z-enemy.z)>enemy.radius+player.radius);
  assert.equal(attackReady({...player,...point},enemy),true);
  assert.equal(huntInteraction({camp:{x:50,z:50},enemies:[dead],animals:[]},{...player,inventory:{}}),null);
  const ground={x:45,z:16};
  for(const offset of [[0,30],[30,0],[-30,0],[0,-30],[0,0]]){
    const goal=approachEnemyGround({x:ground.x+offset[0],z:ground.z+offset[1]},ground);
    for(let angle=0;angle<Math.PI*2;angle+=.2){
      const roaming={x:ground.x+Math.sin(angle)*3.2,z:ground.z+Math.cos(angle)*3.2};
      assert.ok(Math.hypot(goal.x-roaming.x,goal.z-roaming.z)<8);
    }
  }
});

test('enemy one-shots seek authoritative attack, hit and death times, while hidden phases stop', () => {
  const enemy={modelKey:'crow-shaman',phase:'alive',clip:'Attack',attackAt:1000,hitAt:1600,phaseStartedAt:2000};
  assert.deepEqual(enemyAnimationState(enemy,1450),{clip:'Attack',elapsed:.45});
  assert.deepEqual(enemyAnimationState({...enemy,clip:'Hit'},1800),{clip:'Hit',elapsed:.2});
  assert.deepEqual(enemyAnimationState({...enemy,phase:'dead'},2700),{clip:'Death',elapsed:.7});
  assert.equal(enemyAnimationState({...enemy,phase:'respawning'},9000),null);
  assert.deepEqual(enemyAnimationState({...enemy,clip:'Run_Loop'},2400),{clip:'Run_Loop',elapsed:null});
  assert.deepEqual(enemyAnimationState(enemy,900),{clip:'Attack',elapsed:0});
  assert.throws(()=>enemyAnimationState({...enemy,clip:'Invented'},2000),/unsupported enemy clip/);
});

test('enemy requires all six real clips and missing catalog entries reject without fallback', async () => {
  const animations=ENEMY_CLIPS.map(name=>({name}));
  assert.doesNotThrow(()=>requireEnemyClips(animations,'crow-shaman'));
  assert.throws(()=>requireEnemyClips(animations.filter(clip=>clip.name!=='Hit'),'crow-shaman'),/missing clips Hit/);
  const assets=new WorldAssets();assets.catalog={assets:[]};
  await assert.rejects(assets.createEnemy('crow-shaman'),/Missing verified enemy/);
  assert.equal(assets.templates.size,0);assert.equal(assets.animals.size,0);
});

test('enemy actor replaces clips, clamps death and resets the next lifetime', () => {
  const root=new THREE.Group(),joint=new THREE.Bone();joint.name='Body';root.add(joint);
  const clips=ENEMY_CLIPS.map((name,index)=>new THREE.AnimationClip(name,name==='Death'?1.2:1,[new THREE.NumberKeyframeTrack('Body.position[y]',[0,1],[0,index])]));
  const assets=new WorldAssets();assets.templates.set('crow-shaman',{gltf:{scene:root,animations:clips},asset:{}});
  const actor=assets.createAnimal('crow-shaman');
  actor.play('Run_Loop');actor.update(.6);actor.sampleOnce('Attack',.45);
  assert.ok(Math.abs(actor.root.getObjectByName('Body').position.y-1.35)<1e-6);
  actor.sampleOnce('Hit',.2);assert.ok(Math.abs(actor.root.getObjectByName('Body').position.y-.8)<1e-6);
  actor.sampleOnce('Death',9);assert.equal(actor.root.getObjectByName('Body').position.y,5);
  actor.stop();actor.play('Idle_Loop');actor.update(.1);assert.equal(actor.root.getObjectByName('Body').position.y,0);
  actor.dispose();assert.equal(assets.animals.size,0);
});

test('hurt feedback uses server sequences, not costs of gathering or free attacks', () => {
  const player={id:'p',energy:100,hurtSequence:0,defeatSequence:0};
  assert.equal(playerDamageEvent(player,{...player,energy:98,attackSequence:1}),null);
  assert.equal(playerDamageEvent(null,{...player,hurtSequence:9}),null);
  assert.equal(playerDamageEvent(player,{...player,energy:85,hurtSequence:1}),'hurt');
  assert.equal(playerDamageEvent(player,{...player,energy:0,hurtSequence:1,defeatSequence:1,downedUntil:5000}),'defeat');
});

test('downed controls resume on authoritative recovery and camp relocation snaps only on recovery', () => {
  const before={id:'p',downedUntil:5000,attackSequence:0};
  assert.equal(canStartAttack(before,4000),false);
  assert.equal(canStartAttack(before,6000),false);
  assert.equal(canStartAttack({...before,downedUntil:0,cookingEndsAt:6000},4000),true);
  assert.equal(playerRecovered(before,{id:'p',downedUntil:0}),true);
  assert.equal(playerRecovered(before,{id:'q',downedUntil:0}),false);
  assert.equal(playerRecovered({id:'p',downedUntil:0},{id:'p',downedUntil:0}),false);
});

test('render clock caps high refresh displays and tolerates normal60Hz timestamp jitter', () => {
  for(const hz of [60,120,144,240]){
    const clock=new FrameClock(0),frames=[];
    for(let index=0;index<hz*5;index++){
      const now=index*1000/hz+(index?(index%2?.7:-.7):0),dt=clock.advance(now);
      if(dt!==null)frames.push(dt);
    }
    assert.ok(frames.length>=299&&frames.length<=301,`${hz}Hz yielded ${frames.length} frames instead of300`);
    assert.ok(frames.every(dt=>dt>=0&&dt<=.06));
  }
  const clock=new FrameClock(0);assert.notEqual(clock.advance(0),null);
  for(const time of [100,1000,9000])assert.equal(clock.advance(time,true),null);
  assert.ok(clock.advance(9016)<=.06);
});

test('five enemy mixers remain independent and release each actor without affecting shared templates', () => {
  const root=new THREE.Group(),joint=new THREE.Bone();joint.name='Body';root.add(joint);
  const clips=ENEMY_CLIPS.map((name,index)=>new THREE.AnimationClip(name,1,[new THREE.NumberKeyframeTrack('Body.position[y]',[0,1],[0,index])]));
  const assets=new WorldAssets();assets.templates.set('crow-shaman',{gltf:{scene:root,animations:clips},asset:{},lods:[]});
  const actors=Array.from({length:5},()=>assets.createAnimal('crow-shaman'));
  actors[0].sampleOnce('Attack',.5);actors[1].sampleOnce('Hit',.5);actors[2].sampleOnce('Death',.5);
  assert.deepEqual(actors.map(actor=>actor.root.getObjectByName('Body').position.y),[1.5,2,2.5,0,0]);
  actors[0].dispose();actors[0].dispose();assert.equal(assets.animals.size,4);assert.equal(assets.templates.size,1);
  assets.dispose();assert.equal(assets.animals.size,0);assert.equal(assets.templates.size,0);
});
