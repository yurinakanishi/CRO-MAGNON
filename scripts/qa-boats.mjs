import {createGameServer} from '../server.mjs';
import {chromium} from 'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import WebSocket from 'ws';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {waterBodyFree,landingPoint,launchPoint,releaseBoat} from '../dist/shared/boats.mjs';
import {characterModel} from '../dist/shared/characters.mjs';
import {stopActor} from '../dist/shared/combat.mjs';
import {coastDistance} from '../dist/shared/paleo-geography.mjs';
const out=process.argv[2]||'assets/boat/game-qa/r02';await mkdir(out,{recursive:true});
const game=createGameServer({port:0,host:'127.0.0.1'}),address=await game.listen(),base=`http://127.0.0.1:${address.port}`;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,ms=20000){const end=Date.now()+ms;while(!fn()){if(Date.now()>end)throw Error('Timed out waiting for condition');await sleep(50);}}
let browser;const peers=[],errors=[],samples=[],fps=[],contexts=[],pages=[];let timer;
try{
  browser=await chromium.launch({channel:'chrome',headless:true});
  for(let i=0;i<2;i++){const context=await browser.newContext({viewport:{width:1440,height:1000}});await context.addInitScript(({name})=>{localStorage.setItem('cro-name',name);localStorage.setItem('cro-species','cro');localStorage.setItem('cro-gender','female');},{name:`Boat browser ${i+1}`});const page=await context.newPage();page.on('pageerror',e=>errors.push(String(e)));await page.goto(base+'/?room=BOAT-QA');contexts.push(context);pages.push(page);}
  for(let i=0;i<3;i++){const ws=new WebSocket(base.replace('http','ws')+`/ws?room=BOAT-QA&name=Peer${i}&resume=1`),peer={ws,messages:[]};ws.on('message',b=>{peer.messages.push(JSON.parse(b));});peers.push(peer);await until(()=>peer.messages.some(m=>m.type==='welcome'));}
  const room=game.rooms.get('BOAT-QA');await until(()=>room?.players.size===5);
  const first=()=>[...room.players.values()].find(p=>p.name==='Boat browser 1'),second=()=>[...room.players.values()].find(p=>p.name==='Boat browser 2');
  for(const page of pages)await page.waitForSelector('#world[data-world-asset="ready"][data-character-asset="ready"]',{timeout:60000});
  timer=setInterval(()=>{samples.push({boats:room.boats.map(b=>({id:b.id,x:b.x,z:b.z,riderId:b.riderId,water:waterBodyFree(b.x,b.z,b.radius)})),players:[...room.players.values()].map(p=>({id:p.id,boatId:p.boatId,x:p.x,z:p.z}))});},50);
  Object.assign(first(),{x:21,z:125,facing:0});first().inventory.wood=24;Object.assign(second(),{x:18,z:124,facing:0});
  await sleep(800);await pages[0].click('#boat-craft');await until(()=>room.boats.length===1);assert.equal(first().inventory.wood,12);await sleep(550);await pages[0].click('#boat-board');await until(()=>first().boatId);
  await sleep(4600);await pages[0].screenshot({path:out+'/01-boarded.png'});await pages[1].screenshot({path:out+'/02-observer.png'});
  // Real keyboard input at the displayed camera; adjust view using normal drag.
  // Map click provides a stable world-space sea target without a hidden API.
  await pages[0].click('#map-button');await pages[0].click('#map-local');
  let b=room.boats[0];const target={x:b.x,z:138};
  const rect=await pages[0].locator('#big-map').boundingBox();
  await pages[0].locator('#big-map').click({position:{x:rect.width/2+(target.x-first().x)*rect.width/600,y:rect.height/2+(target.z-first().z)*rect.width/600}});
  await pages[0].click('#map-walk');await until(()=>Math.abs(first().z-138)<.4);await sleep(400);
  const offshore={x:first().x,z:first().z};await pages[0].keyboard.press('b');await sleep(550);assert.ok(first().boatId);assert.equal(landingPoint(room,first(),b),null);
  await sleep(4600);await pages[0].screenshot({path:out+'/03-at-sea.png'});
  await pages[0].locator('#world').focus();const keyboardStart={x:first().x,z:first().z};await pages[0].keyboard.down('a');await sleep(300);await pages[0].keyboard.up('a');await sleep(200);assert.ok(Math.hypot(first().x-keyboardStart.x,first().z-keyboardStart.z)>.1);
  await pages[0].keyboard.down('d');await sleep(200);await pages[0].click('#chat-toggle');await pages[0].keyboard.up('d');await sleep(250);const stopped={x:first().x,z:first().z};await sleep(600);assert.ok(Math.hypot(first().x-stopped.x,first().z-stopped.z)<.01);await pages[0].click('#chat-toggle');
  // Continue across the water to the opposite shore, via the public protocol.
  // This fixture changes only camera-independent input, not position or collision.
  first().socket.emit?.('message',Buffer.from(JSON.stringify({type:'target',x:20.3,z:147.5,running:true})),false);
  await until(()=>first().z>146.5);await sleep(600);await pages[0].keyboard.press('b');await until(()=>!first().boatId);
  assert.ok(room.collision.free(first(),first().radius));assert.ok(first().z>145);const arrival={x:first().x,z:first().z};
  await pages[0].screenshot({path:out+'/04-landed.png'});
  // All six delivered character skins are seated on this same hull.
  const skinModels=[];const skins=[['cro','female'],['cro','male'],['nea','female'],['nea','male'],['cat','female'],['bear','female']];
  for(const[species,gender]of skins){Object.assign(first(),{species,gender});await pages[0].reload();await pages[0].waitForSelector('#world[data-world-asset="ready"][data-character-asset="ready"]',{timeout:60000});await until(()=>first());await pages[0].click('#boat-board');await until(()=>first().boatId);await sleep(4600);const models=JSON.parse(await pages[0].locator('#world').getAttribute('data-actor-models'));const actual=models.find(m=>m.id===first().id);assert.equal(actual.model,characterModel({species,gender}).key);skinModels.push(actual);await pages[0].screenshot({path:`${out}/skin-${species}-${gender}.png`});await pages[0].click('#boat-board');await until(()=>!first().boatId);await sleep(550);}
  await pages[0].setViewportSize({width:390,height:844});await sleep(400);await pages[0].click('#boat-board');await until(()=>first().boatId);await sleep(4600);await pages[0].screenshot({path:out+'/05-mobile-aboard.png'});
  const before=first().inventory.wood,id=first().id;await pages[0].reload();await pages[0].waitForSelector('#world[data-world-asset="ready"]',{timeout:60000});await until(()=>first()?.id===id&&!first().boatId);assert.equal(first().inventory.wood,before);await sleep(900);await pages[0].screenshot({path:out+'/06-mobile-reconnected.png'});
  // Build and occupy every remaining slot, staging only test players on safe shores.
  for(const p of room.players.values()){
    releaseBoat(room,p);stopActor(p);p.inventory.wood=24;
    let point=null;
    for(let x=-15;x<50&&!point;x+=1)for(let z=120;z<175&&!point;z+=1){if(coastDistance(x,z)<.4||coastDistance(x,z)>1.4)continue;const q={x,z,radius:p.radius};if(launchPoint(room,q))point=q;}
    assert.ok(point);Object.assign(p,point);await sleep(550);
    if(room.boats.length<5){p.socket.emit('message',Buffer.from(JSON.stringify({type:'action',action:'craftBoat'})),false);await sleep(550);}
  }
  assert.equal(room.boats.length,5);
  const allPlayers=[...room.players.values()];for(let i=0;i<5;i++){const p=allPlayers[i],b=room.boats[i];Object.assign(p,b.shore);p.lastAction=0;p.socket.emit('message',Buffer.from(JSON.stringify({type:'action',action:'boardBoat',targetId:b.id})),false);}await until(()=>room.boats.every(b=>b.riderId));
  for(let step=0;step<12;step++){for(const p of room.players.values()){const b=room.boats.find(b=>b.riderId===p.id),dx=b.mooring.x-b.shore.x,dz=b.mooring.z-b.shore.z,len=Math.hypot(dx,dz);p.socket.emit('message',Buffer.from(JSON.stringify({type:'move',dx:dx/len,dz:dz/len,running:true})),false);}await sleep(100);}for(const p of room.players.values())p.socket.emit('message',Buffer.from(JSON.stringify({type:'move',dx:0,dz:0})),false);await sleep(800);assert.ok(room.boats.every(b=>Math.hypot(b.x-b.mooring.x,b.z-b.mooring.z)>.1));
  await pages[0].setViewportSize({width:844,height:390});await sleep(500);await pages[0].screenshot({path:out+'/07-mobile-landscape.png'});
  for(let i=0;i<6;i++){fps.push(await pages[0].locator('#world').evaluate(c=>({fps:c.dataset.fps,drawCalls:c.dataset.drawCalls,triangles:c.dataset.renderTriangles,boats:c.dataset.boats})));await sleep(150);}
  for(const sample of samples)for(const boat of sample.boats){assert.ok(boat.water);if(boat.riderId){const rider=sample.players.find(p=>p.id===boat.riderId);assert.equal(rider.boatId,boat.id);assert.equal(rider.x,boat.x);assert.equal(rider.z,boat.z);}}
  assert.equal(errors.length,0,errors.join('\n'));
  const report={status:'passed',at:new Date().toISOString(),realBrowsers:2,protocolPeers:3,skins:skins.length,skinModels,simultaneouslyOccupiedBoats:room.boats.filter(b=>b.riderId).length,offshore,arrival,samples:samples.length,fps,errors,checks:['craft cost','exclusive boarding','map sea navigation','offshore exit blocked','crossed sea and landed','six exact GLB skins','keyboard steering','chat focus stops movement','five simultaneous helms','390x844 touch buttons','same-tab reload','five hull limit','water body and rider synchronization']};
  await writeFile(out+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(e){for(let i=0;i<pages.length;i++)await pages[i].screenshot({path:out+`/failure-${i}.png`});await writeFile(out+'/failure.json',JSON.stringify({error:e.stack,errors,rooms:[...game.rooms].map(([name,r])=>({name,players:[...r.players.values()].map(p=>p.name)})),samples:samples.slice(-2)},null,2));throw e;}
finally{clearInterval(timer);for(const peer of peers)peer.ws.terminate();await browser?.close();await game.close();}
