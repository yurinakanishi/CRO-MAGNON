import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {WebSocket} from 'ws';
import {createGameServer} from '../server.mjs';
import {CollisionWorld,overlap} from '../shared/collision.mjs';
import {withinAttackReach,enemyIsSolid} from '../shared/combat.mjs';
import {animalIsSolid} from '../shared/hunting.mjs';
import {attackProfile} from '../shared/combat-profiles.mjs';
const game=createGameServer({port:0,host:'127.0.0.1'}),clients=[],amounts=new Map();
const collision=new CollisionWorld(undefined,{active:o=>!o.resourceId||(amounts.get(o.resourceId)??1)>0});
const report={startedAt:new Date().toISOString(),mode:'real-clock public WebSocket; normal terrain and NPCs; no internal state mutation',status:'running',maxPlayers:0,snapshots:0,staticPenetrations:0,dynamicPenetrations:0,projectiles:new Set(),fights:[],errors:[]};
const me=c=>c.state?.players.find(p=>p.id===c.id),enemy=c=>c.state?.enemies[0],send=(c,m)=>c.socket.send(JSON.stringify(m));
async function until(label,check,timeout=8000){const end=Date.now()+timeout;while(Date.now()<end){if(check())return;await delay(30);}throw new Error(label+' timed out');}
try{
  const address=await game.listen(),profiles=[['cat','female'],['bear','female'],['cro','female'],['nea','female'],['nea','male']];
  for(const [i,[species,gender]] of profiles.entries()){
    const socket=new WebSocket(`ws://127.0.0.1:${address.port}/ws?${new URLSearchParams({room:'FANTASY-SMOKE',name:'Fantasy-'+i,species,gender})}`),c={socket};clients.push(c);
    socket.on('error',e=>report.errors.push(e.message));socket.on('message',bytes=>{const m=JSON.parse(bytes);if(m.type==='welcome')c.id=m.id;if(m.type==='error')report.errors.push(m.code||m.text);if(m.type!=='state')return;c.state=m;
      if(i)return;report.snapshots++;report.maxPlayers=Math.max(report.maxPlayers,m.players.length);for(const r of m.resources||[])amounts.set(r.id,r.amount);for(const p of m.projectiles)report.projectiles.add(p.id);
      const actors=[...m.players,...m.animals.filter(animalIsSolid),...m.enemies.filter(enemyIsSolid)];for(const a of actors)if(!collision.free(a,a.radius))report.staticPenetrations++;
      for(let a=0;a<actors.length;a++)for(let b=a+1;b<actors.length;b++)if(overlap(actors[a],actors[a].radius,{...actors[b],type:'circle'}))report.dynamicPenetrations++;
    });await until('join',()=>c.id&&c.state);
  }
  await until('five peers',()=>clients.every(c=>c.state.players.length===5));
  for(const fighter of clients.slice(0,2)){
    const profile=attackProfile(me(fighter)),startSequence=me(fighter).attackSequence;send(fighter,{type:'action',action:'attack'});
    await until('air attack replicated',()=>clients.every(c=>c.state.players.find(p=>p.id===fighter.id).attackSequence>startSequence));await delay(profile.durationMs+100);assert.equal(enemy(fighter).health,75);
    const e=enemy(fighter);send(fighter,{type:'target',x:e.x,z:e.z+(profile.key==='magic'?6:3),running:true});
    console.log(profile.key+': approaching the normal crow clearing');
    await until('in weapon range',()=>withinAttackReach(me(fighter),enemy(fighter))&&collision.segmentFree(me(fighter),enemy(fighter),.12),45000);
    const result={weapon:profile.key,health:[],attacks:0};
    while(enemy(fighter).health>0){
      const hp=enemy(fighter).health;send(fighter,{type:'action',action:'attack',targetId:enemy(fighter).id});result.attacks++;
      await until('damage',()=>enemy(fighter).health<hp,4000);result.health.push(enemy(fighter).health);
      await until('shared damage',()=>clients.every(c=>enemy(c).health===result.health.at(-1)));await delay(profile.cooldownMs);
    }
    assert.deepEqual(result.health,[50,25,0]);assert.equal(enemy(fighter).phase,'dead');result.replicatedTo=clients.length;report.fights.push(result);console.log(JSON.stringify(result));
    send(fighter,{type:'target',x:49,z:55,running:true});
    if(profile.key==='katana'){await until('normal respawn',()=>enemy(fighter).phase==='alive'&&enemy(fighter).health===75,52000);}
  }
  assert.equal(report.maxPlayers,5);assert.ok(report.projectiles.size>=4);assert.equal(report.staticPenetrations,0);assert.equal(report.dynamicPenetrations,0);assert.deepEqual(report.errors,[]);report.status='passed';
}catch(error){report.status='failed';report.errors.push(error.stack);process.exitCode=1;}
finally{clients.forEach(c=>c.socket.terminate());await game.close();report.projectiles=[...report.projectiles];report.finishedAt=new Date().toISOString();await writeFile('assets/fantasy-combat-qa.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));}
