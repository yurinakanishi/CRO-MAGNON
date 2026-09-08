import { createGameServer } from '../server.mjs';
import WebSocket from 'ws';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { RIFTS, adventureProgress, travelSeals, regionById } from '../dist/shared/adventure-regions.mjs';
import { actorObstacle } from '../dist/shared/animals.mjs';
import { enemyIsSolid } from '../dist/shared/combat.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'playwright');
const out=process.argv[2]??'assets/adventure/game-qa';await mkdir(out,{recursive:true});
const game=createGameServer({port:0,host:'127.0.0.1',tickMs:25});await game.listen();
const base=`http://127.0.0.1:${game.address().port}`,roomName='ADVENTURE-QA',pages=[],peers=[],errors=[],networkErrors=[],fps=[],visits=[],samples=[];
let browser,timer;const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label,ms=60000){const start=Date.now();while(!fn()){if(Date.now()-start>ms)throw Error(`Timed out: ${label}`);await sleep(60);}}
const room=()=>game.rooms.get(roomName),first=()=>[...room().players.values()].find(p=>p.name==='Explorer 1'),second=()=>[...room().players.values()].find(p=>p.name==='Explorer 2');
const send=(p,message)=>p.socket.emit('message',Buffer.from(JSON.stringify(message)),false);
const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
async function openBook(id){await pages[0].click('#adventure-button');if(id)await pages[0].click(`[data-region="${id}"]`);}
async function go(p,point,label){send(p,{type:'target',x:point.x,z:point.z,running:true});await until(()=>distance(p,point)<1.0,label);send(p,{type:'move',dx:0,dz:0});}
async function nextWaypoint(r,c){await openBook(r.id);await pages[0].click('#adventure-travel');await until(()=>adventureProgress(first(),r.id).visited.includes(c.id),c.name);}
async function gather(p,r){
  for(const resource of room().resources.filter(x=>x.regionId===r.id&&x.type===r.material)){
    if(adventureProgress(p,r.id).gathered>=r.amount)break;
    const q=room().collision.nearestFree({x:resource.x-2,z:resource.z},p.radius,[],3);assert.ok(q);
    await go(p,q,'resource approach');
    for(let i=0;i<r.amount+2&&adventureProgress(p,r.id).gathered<r.amount;i++){await sleep(500);send(p,{type:'action',action:'gather'});}
  }
  assert.ok(adventureProgress(p,r.id).gathered>=r.amount,r.id+' collected');
}
async function battle(r){
  for(const enemy of room().enemies.filter(e=>e.id.startsWith(`guardian-${r.id}-`))){
    const p=first();
    if(p.energy<85&&p.inventory.cookedMeat){send(p,{type:'action',action:'eatMeat'});await sleep(550);}
    await go(p,{x:enemy.home.x,z:enemy.home.z+6},'guardian approach');
    // Input goes through the ordinary server protocol, including aim assistance,
    // weapon timing and damage. No health/position/quest mutations.
    for(let i=0;i<12&&enemy.phase==='alive';i++){send(p,{type:'action',action:'attack',targetId:enemy.id});await sleep(1200);}
    assert.notEqual(enemy.phase,'alive',enemy.id+' defeated');
    await until(()=>adventureProgress(p,r.id).defeated?.includes(enemy.id),'guardian credit');
  }
}
try{
  browser=await chromium.launch({channel:'chrome',headless:true});
  for(let i=0;i<2;i++){
    const context=await browser.newContext({viewport:{width:1440,height:1000}});
    await context.addInitScript(({name,species})=>{localStorage.setItem('cro-name',name);localStorage.setItem('cro-species',species);localStorage.setItem('cro-gender','female');},{name:`Explorer ${i+1}`,species:i?'bear':'cat'});
    const page=await context.newPage();pages.push(page);page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    await page.goto(`${base}/?autostart=1&room=${roomName}`);
  }
  for(let i=0;i<3;i++){
    const ws=new WebSocket(base.replace('http','ws')+`/ws?room=${roomName}&name=Peer${i}&resume=1`);peers.push(ws);ws.on('error',e=>networkErrors.push(String(e)));
  }
  await until(()=>room()?.players.size===5,'five players');
  for(const page of pages)await page.waitForSelector('#world[data-world-asset="ready"][data-character-asset="ready"]',{timeout:60000});
  await pages[0].click('#run-button');
  timer=setInterval(()=>{
    const r=room();let violations=0;
    for(const p of r.players.values())if(!p.downedUntil&&!p.mountId&&!p.boatId){const dynamic=[...r.players.values()].filter(a=>a!==p).concat(r.animals.filter(a=>a.phase==='alive'),r.enemies.filter(enemyIsSolid)).map(actorObstacle);if(!r.collision.free(p,p.radius,dynamic))violations++;}
    samples.push({at:Date.now(),violations});
  },200);
  await openBook();await pages[0].screenshot({path:out+'/01-journal.png'});await pages[0].click('#modal-close');
  const routeOrder=['high-pass','echo-valley','amber-oasis','stone-forest','blue-chasm'];
  for(const id of routeOrder){
    const r=regionById(id);console.log(`Visiting ${r.name}`);
    await openBook(id);await pages[0].click('#adventure-travel');await until(()=>distance(first(),r.camp)<12,'UI expedition');
    // Four other participants enter the same region using the public protocol.
    for(const p of room().players.values())if(p!==first())send(p,{type:'expedition',destination:id});
    await until(()=>[...room().players.values()].every(p=>distance(p,r.camp)<12),'shared arrival');
    const allyPoint=room().collision.nearestFree({x:r.x+4,z:r.z+20},second().radius,[],3);await go(second(),allyPoint,'ally lookout');
    for(const c of r.checkpoints){await nextWaypoint(r,c);if(c===r.checkpoints[1]){await sleep(900);await pages[0].screenshot({path:`${out}/${id}.png`});}}
    if(r.amount)await gather(first(),r);
    if(r.kills)await battle(r);
    await go(first(),r.camp,'return for report');await openBook(id);await pages[0].click('#adventure-camp');
    await until(()=>adventureProgress(first(),id).claimed,'claim');await pages[0].click('#modal-close');
    assert.ok(travelSeals(first())>0);visits.push({id,progress:structuredClone(adventureProgress(first(),id))});
    fps.push(await pages[0].locator('#world').evaluate(c=>({region:c.dataset.adventureRegion,fps:c.dataset.fps,drawCalls:c.dataset.drawCalls,triangles:c.dataset.renderTriangles,materials:c.dataset.adventureMaterials,chunks:c.dataset.terrainChunks})));
    console.log(`Completed ${r.name}`);
  }
  // Actual unlocked entry, shadow objective sequence and return through the rift.
  await openBook('shadow-realm');await pages[0].click('#adventure-travel');await until(()=>distance(first(),regionById('stone-forest').camp)<12,'rift approach expedition');
  await go(first(),RIFTS[0],'walk to rift');await sleep(650);await pages[0].keyboard.press('e');await until(()=>distance(first(),RIFTS[1])<12,'rift entry');
  const shadow=regionById('shadow-realm');
  for(const c of shadow.checkpoints){await nextWaypoint(shadow,c);if(c===shadow.checkpoints[1]){await sleep(2000);await pages[0].screenshot({path:out+'/shadow-realm.png'});}}
  await battle(shadow);await go(first(),shadow.camp,'shadow report');await openBook(shadow.id);await pages[0].click('#adventure-camp');await until(()=>adventureProgress(first(),shadow.id).claimed,'shadow claim');
  await pages[0].screenshot({path:out+'/08-completed.png'});await pages[0].click('#adventure-exit');await until(()=>distance(first(),RIFTS[0])<6,'return rift');
  // The same tab keeps the adventure log and inventory on reconnect.
  const before={id:first().id,inventory:{...first().inventory},adventure:structuredClone(first().adventure)};
  await pages[0].reload();await pages[0].waitForSelector('#world[data-world-asset="ready"][data-character-asset="ready"]',{timeout:60000});
  assert.equal(first().id,before.id);assert.deepEqual(first().inventory,before.inventory);assert.deepEqual(first().adventure,before.adventure);
  await pages[0].setViewportSize({width:390,height:844});await openBook('shadow-realm');await pages[0].screenshot({path:out+'/09-mobile-journal.png'});
  assert.equal(await pages[0].evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'mobile horizontal overflow');
  await pages[0].click('#modal-close');await pages[0].click('#map-button');await pages[0].screenshot({path:out+'/10-mobile-map.png'});
  await pages[0].click('#map-local');await pages[0].screenshot({path:out+'/11-mobile-local.png'});await pages[0].click('#modal-close');
  await pages[0].setViewportSize({width:844,height:390});await openBook('high-pass');await pages[0].screenshot({path:out+'/12-landscape-journal.png'});
  assert.equal(errors.length,0,errors.join('\n'));assert.equal(networkErrors.length,0);assert.equal(samples.reduce((n,s)=>n+s.violations,0),0,'body collisions');
  const report={status:'passed',at:new Date().toISOString(),realBrowsers:2,protocolPeers:3,samples:samples.length,collisionViolations:0,visits,shadow:adventureProgress(first(),'shadow-realm'),fps,errors,checks:['six actual walking routes','18 waypoints','local collection','four guardian fights','atomic quest rewards','five-player arrival','three-seal rift unlock','return portal','same-tab resume','390x844 journal and map','844x390 layout']};
  await writeFile(out+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(error){
  for(let i=0;i<pages.length;i++)await pages[i].screenshot({path:`${out}/failure-${i}.png`}).catch(()=>{});
  await writeFile(out+'/failure.json',JSON.stringify({error:error.stack,errors,networkErrors,visits,fps,last:first()?{x:first().x,z:first().z,adventure:first().adventure}:null},null,2));throw error;
}finally{clearInterval(timer);for(const ws of peers)ws.terminate();await browser?.close();await game.close();}
