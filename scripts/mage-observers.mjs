import {WebSocket} from 'ws';
import {writeFile,mkdir,access} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {CollisionWorld} from '../dist/shared/collision.mjs';
import {animalIsSolid} from '../dist/shared/hunting.mjs';
import {enemyIsSolid} from '../dist/shared/combat.mjs';

// Three passive peers leave two seats for the actual kunoichi and mage browsers.
const [url='ws://127.0.0.1:3000/ws',room='FANTASY-BROWSER-QA',file='assets/fantasy-network-qa.json']=process.argv.slice(2);
const output=resolve(file),clients=[],amounts=new Map();
const collision=new CollisionWorld(undefined,{active:o=>!o.resourceId||(amounts.get(o.resourceId)??1)>0});
const report={startedAt:new Date().toISOString(),url,room,role:'three passive peers, two browser players',maxPlayers:0,states:0,characters:[],attacks:{},projectileIds:[],impactCount:0,sixthClientRefused:false,staticPenetrations:0,examples:[],changes:[],errors:[]};
const previous=new Map();let stopping=false,overflow=false;
const save=async()=>{await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');};
async function stop(){if(stopping)return;stopping=true;clearTimeout(limit);clients.forEach(c=>c.socket.terminate());report.finishedAt=new Date().toISOString();await save();console.log(JSON.stringify({output,maxPlayers:report.maxPlayers,attacks:report.attacks,projectiles:report.projectileIds.length,staticPenetrations:report.staticPenetrations,errors:report.errors}));process.exit(report.errors.length?1:0);}
const profiles=[['Kunoichi-peer','cat','female'],['Cro-peer','cro','female'],['Neanderthal-peer','nea','male']];
for(const [index,[name,species,gender]] of profiles.entries()){
  const socket=new WebSocket(`${url}?${new URLSearchParams({room,name,species,gender})}`),client={socket};clients.push(client);
  socket.on('error',e=>report.errors.push(e.message));
  socket.on('message',bytes=>{
    const s=JSON.parse(bytes);if(s.type==='error')report.errors.push(s.code||s.text);
    if(s.type==='welcome'){client.id=s.id;return;}if(s.type!=='state')return;
    const p=s.players.find(p=>p.id===client.id);
    if(p&&!client.moved){client.moved=true;socket.send(JSON.stringify({type:'target',x:47+index*2,z:56,running:true}));}
    if(index!==0)return;
    if(s.combatVersion!==3||s.characterVersion!==2){report.errors.push('Outdated server build');void stop();return;}
    report.states++;report.maxPlayers=Math.max(report.maxPlayers,s.players.length);report.lastPlayers=s.players;
    if(s.resources)for(const r of s.resources)amounts.set(r.id,r.amount);
    report.characters=[...new Set([...report.characters,...s.players.map(p=>`${p.species}/${p.gender}`)])];
    for(const p of s.players){const old=previous.get(p.id);report.attacks[p.species]=Math.max(report.attacks[p.species]||0,p.attackSequence);if(old&&(old.attackSequence!==p.attackSequence||old.energy!==p.energy||JSON.stringify(old.inventory)!==JSON.stringify(p.inventory)))report.changes.push({serverTime:s.serverTime,id:p.id,name:p.name,species:p.species,attackSequence:p.attackSequence,energy:p.energy,inventory:p.inventory});previous.set(p.id,p);}
    for(const orb of s.projectiles||[])if(!report.projectileIds.includes(orb.id))report.projectileIds.push(orb.id);
    report.impactCount=Math.max(report.impactCount,(s.projectileImpacts||[]).length);
    report.lastEnemies=s.enemies;report.lastAnimals=s.animals;
    for(const actor of [...s.players,...s.animals.filter(animalIsSolid),...(s.enemies||[]).filter(enemyIsSolid)])if(!collision.free(actor,actor.radius)){report.staticPenetrations++;if(report.examples.length<8)report.examples.push({id:actor.id,x:actor.x,z:actor.z});}
    if(s.players.length===5&&!overflow){overflow=true;const extra=new WebSocket(`${url}?${new URLSearchParams({room,name:'Fantasy-overflow'})}`);extra.on('error',()=>{});extra.on('message',data=>{const m=JSON.parse(data);if(m.code==='ROOM_FULL')report.sixthClientRefused=true;else if(m.type==='welcome')report.errors.push('Sixth player joined');extra.close();});setTimeout(()=>extra.terminate(),3500);console.log('Five players synchronized; overflow check started.');}
    if(report.states%100===0)void save();
  });
}
process.stdin.setEncoding('utf8');process.stdin.on('data',s=>{if(s.trim()==='q')void stop();});process.stdin.resume();
process.once('SIGINT',()=>void stop());process.once('SIGTERM',()=>void stop());
const limit=setTimeout(()=>void stop(),10*60*1000);console.log(`Fantasy peers for ${room}; q saves and closes only these three peers.`);

const stopWatch=setInterval(()=>access('output/floppy-ear-qa.stop').then(()=>void stop()).catch(()=>{}),1000);
