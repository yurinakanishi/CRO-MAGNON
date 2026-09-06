import test from 'node:test';
import assert from 'node:assert/strict';
import { CollisionWorld } from '../shared/collision.mjs';
import { attackProfile } from '../shared/combat-profiles.mjs';
import { startAttack, resolveAttack, updateProjectiles, withinAttackReach } from '../shared/combat.mjs';
import { canStartAttack } from '../src/combat-input.js';
import { updateHunting } from '../shared/hunting.mjs';

const target=(id='crow',x=20,z=25)=>({id,x,z,radius:.4,health:75,maxHealth:75,hostile:true,phase:'alive',name:'呪術師'});
function scene(species='bear',obstacles=[]) {
  const player={id:'mage',species,gender:'female',x:20,z:20,radius:species==='cat'?.32:.28,facing:0,energy:100,attackAt:0,attackSequence:0,inventory:{rawMeat:0,cookedMeat:0}};
  const room={players:new Map([[player.id,player]]),animals:[],enemies:[],collision:new CollisionWorld(obstacles,{river:false}),camp:{x:10,z:10}};
  return {room,player};
}
function cast(room,player,now=1000,message={}) {
  assert.equal(startAttack(room,player,message,now).accepted,true);
  const impact=now+attackProfile(player).impactMs;
  assert.equal(resolveAttack(room,player,impact-1),null);
  const result=resolveAttack(room,player,impact);
  return {result,impact};
}

test('katana free swing, shorter reach, wider arc, impact time and cooldown follow the server character',()=>{
  const {room,player}=scene('cat');const enemy=target('crow',20,21.5);room.enemies.push(enemy);
  const {result,impact}=cast(room,player,1000,{weapon:'magic',damage:999,impactMs:0});
  assert.equal(result.hit,true);assert.equal(result.weapon,'katana');assert.equal(enemy.health,50);
  assert.equal(impact,1267);assert.equal(player.energy,98);
  assert.equal(canStartAttack(player,1699),false);assert.equal(canStartAttack(player,1700),true);
  enemy.z=22;assert.equal(withinAttackReach(player,enemy),false);
  assert.equal(cast(room,player,1700).result.hit,false);assert.equal(enemy.health,50);
  room.enemies=[];assert.equal(cast(room,player,2400).result.hit,false);
});

test('magic launches without a target, flies with elapsed time, hits once and ignores forged spell payloads',()=>{
  const {room,player}=scene();const enemy=target(),far=target('behind',20,27);room.enemies.push(enemy,far);
  const {result,impact}=cast(room,player,1000,{damage:999,reach:1000,weapon:'katana',projectileSpeed:999});
  assert.equal(result.launched,true);assert.equal(room.projectiles.length,1);assert.equal(enemy.health,75);
  assert.equal(updateProjectiles(room,impact+200).length,0);assert.ok(Math.abs(room.projectiles[0].z-21.4)<1e-8);
  const hits=updateProjectiles(room,impact+800);
  assert.equal(hits.length,1);assert.equal(hits[0].target,enemy);assert.equal(enemy.health,50);assert.equal(far.health,75);
  assert.equal(room.projectiles.length,0);assert.equal(room.projectileImpacts[0].hit,true);
  assert.equal(updateProjectiles(room,impact+1600).length,0);assert.equal(room.projectileImpacts.length,0);
  assert.equal(player.energy,96);assert.equal(canStartAttack(player,2099),false);assert.equal(canStartAttack(player,2100),true);
});

test('a target can dodge a flying orb, while a target entering its path can be hit',()=>{
  const {room,player}=scene();const enemy=target();room.enemies.push(enemy);
  const {impact}=cast(room,player);updateProjectiles(room,impact+150);enemy.x=22;
  assert.equal(updateProjectiles(room,impact+900).length,0);assert.equal(enemy.health,75);
  enemy.x=20;enemy.z=27.5;
  assert.equal(updateProjectiles(room,impact+1100)[0].target,enemy);assert.equal(enemy.health,50);
});

test('thin and rotated walls stop magic even on a long tick, including immediately beside the caster',()=>{
  for(const obstacle of [
    {id:'wall',type:'box',x:20,z:23,hx:2,hz:.015,c:1,s:0,height:2},
    {id:'wall',type:'box',x:20,z:23,hx:2,hz:.015,c:Math.cos(.65),s:Math.sin(.65),height:2},
    {id:'boulder',type:'circle',x:20,z:23,radius:.6,height:2},
    {id:'close-wall',type:'box',x:20,z:20.35,hx:2,hz:.04,c:1,s:0,height:2},
  ]) {
    const {room,player}=scene('bear',[obstacle]);const enemy=target();room.enemies.push(enemy);
    const {impact}=cast(room,player);assert.equal(updateProjectiles(room,impact+1200).length,0);
    assert.equal(enemy.health,75);assert.equal(room.projectiles.length,0);assert.equal(room.projectileImpacts[0].hit,false);
    assert.ok(room.projectileImpacts[0].z<enemy.z);
  }
});

test('a near target in front of a wall takes a hit; the rear target and other players stay safe',()=>{
  const {room,player}=scene('bear',[{id:'wall',type:'box',x:20,z:26,hx:2,hz:.1,c:1,s:0,height:2}]);
  const front=target(),behind=target('behind',20,27),friend=target('orl',20,22);friend.hostile=false;
  const peer={...target('peer',20,23),energy:100};room.players.set(peer.id,peer);room.enemies.push(front,behind,friend);
  const {impact}=cast(room,player);assert.equal(updateProjectiles(room,impact+1300)[0].target,front);
  assert.equal(front.health,50);assert.equal(behind.health,75);assert.equal(friend.health,75);assert.equal(peer.health,75);
});

test('range expiration, defeat, disconnect and missing targets cannot leave harmful or accumulating projectiles',()=>{
  for(const cancel of ['range','downed','disconnect']) {
    const {room,player}=scene();const {impact}=cast(room,player);
    if(cancel==='downed')player.downedUntil=10000;
    if(cancel==='disconnect')room.players.clear();
    updateProjectiles(room,impact+2000);assert.equal(room.projectiles.length,0);
  }
});

test('magic kills mammoths through shared hunting and creates the same finite meat once',()=>{
  const {room,player}=scene();room.animals.push({...target('mammoth',20,24),health:25,maxHealth:100,meatRemaining:0});room.enemies=[];
  const {impact}=cast(room,player);const notices=[];updateHunting(room,impact+800,(_p,text)=>notices.push(text));
  assert.equal(room.animals[0].phase,'dying');assert.equal(room.animals[0].health,0);
  updateHunting(room,impact+2000);assert.equal(room.animals[0].phase,'meat');assert.equal(room.animals[0].meatRemaining,4);
  updateHunting(room,impact+8000);assert.equal(room.animals[0].meatRemaining,4);assert.ok(notices.some(text=>text.includes('倒した')));
});
