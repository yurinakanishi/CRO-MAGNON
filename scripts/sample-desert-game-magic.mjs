import * as THREE from 'three';
import {geometryScene} from './measure-collision-bounds.mjs';
import {CharacterAnimation} from '../dist/src/character-animation.js';
import {SpellEffects} from '../dist/src/spell-effects.js';
import {ATTACK_PROFILES} from '../dist/shared/combat-profiles.mjs';
import {startAttack,resolveAttack,updateProjectiles} from '../dist/shared/combat.mjs';

// One standing cast on a flat, unobstructed stage. Execute the actual game
// animation, server projectile simulation (20Hz) and renderer effects (60Hz).
// Terrain/collisions/network latency vary in a live game; no magic path is
// independently authored in this export.
export async function sampleGameMagic(file,{hz=60}={}){
 const gltf=await geometryScene(file),root=gltf.scene,profile=ATTACK_PROFILES.magic;
 const animation=new CharacterAnimation(root,gltf.animations,{walkSpeed:.31219478171365117,runSpeed:.9923619294515033});
 const scene=new THREE.Scene(),effects=new SpellEffects(scene),bone=name=>root.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(name));
 const player={id:'mage-export',species:'bear',gender:'female',x:0,z:0,facing:0,energy:100,attackSequence:0,attackAt:0,inventory:{},path:[],health:100};
 const room={players:new Map([[player.id,player]]),animals:[],enemies:[],projectiles:[],projectileImpacts:[],collision:{nearby:()=>[],surfaceHeight:()=>0,walkSurfaces:[],lineFree:()=>true}};
 const entity={state:player,model:root,gripLeft:bone('Grip.L'),gripRight:bone('Grip.R')};
 if(!entity.gripLeft||!entity.gripRight)throw Error('Missing game grip nodes');
 const begin=10000,step=1000/hz,serverStep=50,duration=1.6,frames=Math.round(duration*hz),snapshots=[];
 const started=startAttack(room,player,{},begin);if(!started.accepted)throw Error('Game cast rejected');animation.playAttack(0);
 let nextServer=begin,firstPose;
 for(let frame=0;frame<=frames;frame++){
  const seconds=frame/hz,now=begin+frame*step;
  while(nextServer<=now+1e-6){resolveAttack(room,player,nextServer);updateProjectiles(room,nextServer);nextServer+=serverStep;}
  if(frame)animation.update(1/hz,0,false);root.updateMatrixWorld(true);
  const pose={};root.traverse(n=>{if(n.isBone)pose[n.name]={translation:n.position.toArray(),rotation:n.quaternion.toArray(),scale:n.scale.toArray()};});
  firstPose??=structuredClone(pose);
  effects.update(room,new Map([[player.id,entity]]),now,frame?1/hz:0,960);
  const charge=seconds<profile.impactMs/1000;
  const particles=Array.from({length:24},(_,id)=>({id,position:[0,0,0],size:0,alpha:0}));
  for(let i=0;i<effects.count;i++){const id=charge?i:14+i;particles[id]={id,position:Array.from(effects.xyz.slice(i*3,i*3+3)),size:effects.size[i],alpha:effects.alpha[i]};}
  const emitter=entity.gripLeft.getWorldPosition(new THREE.Vector3()).add(entity.gripRight.getWorldPosition(new THREE.Vector3())).multiplyScalar(.5).toArray();
  snapshots.push({seconds,pose,particles,emitter,projectile:room.projectiles[0]?{x:room.projectiles[0].x,z:room.projectiles[0].z,travelled:room.projectiles[0].travelled}:null});
 }
 animation.dispose();effects.dispose();
 return {profile,duration,hz,snapshots,firstPose,referenceConditions:'Standing, idle phase zero, unobstructed flat ground, 20Hz server and 60Hz renderer, no network delay; shot expires at its game reach.'};
}
