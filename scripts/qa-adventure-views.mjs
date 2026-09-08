// Visual fixture only. The full unseeded playthrough is qa-adventures.mjs.
import {createGameServer} from '../server.mjs';
import {regionById,RIFTS} from '../dist/shared/adventure-regions.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'playwright');
const out=process.argv[2]??'assets/adventure/visual-qa';await mkdir(out,{recursive:true});
const game=createGameServer({port:0,host:'127.0.0.1'});await game.listen();let browser;const errors=[];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
try{
  browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}});
  page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto(`http://127.0.0.1:${game.address().port}/?room=VISUAL-QA`);await page.waitForSelector('#world[data-world-asset="ready"][data-character-asset="ready"]',{timeout:60000});
  const room=game.rooms.get('VISUAL-QA'),p=[...room.players.values()][0];
  Object.assign(p,{x:-157,z:429});await sleep(6500);await page.screenshot({path:out+'/oasis-spring.png'});
  p.adventure={regions:Object.fromEntries(['high-pass','echo-valley','amber-oasis'].map(id=>[id,{claimed:true,visited:[],gathered:0,kills:0}]))};
  Object.assign(p,{x:RIFTS[0].x,z:RIFTS[0].z});
  p.socket.emit('message',Buffer.from(JSON.stringify({type:'action',action:'rift',targetId:RIFTS[0].id})),false);
  await sleep(6500);assert.equal(page.isClosed(),false);assert.equal(await page.locator('#world').getAttribute('data-adventure-region'),'shadow-realm');
  await page.screenshot({path:out+'/shadow-entry.png'});
  Object.assign(p,{x:regionById('shadow-realm').x,z:regionById('shadow-realm').z});await sleep(2500);await page.screenshot({path:out+'/shadow-garden.png'});
  await page.setViewportSize({width:390,height:844});await page.click('#adventure-button');await page.screenshot({path:out+'/mobile-journal.png'});
  await page.locator('#adventure-detail').scrollIntoViewIfNeeded();await page.screenshot({path:out+'/mobile-objectives.png'});
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);assert.equal(overflow,false);
  await page.click('#modal-close');await page.click('#map-button');await page.screenshot({path:out+'/mobile-map.png'});await page.click('#map-local');await page.screenshot({path:out+'/mobile-local.png'});
  await page.click('#modal-close');await page.setViewportSize({width:844,height:390});await page.click('#adventure-button');await page.screenshot({path:out+'/landscape-journal.png'});
  assert.equal(errors.length,0,errors.join('\n'));await writeFile(out+'/report.json',JSON.stringify({status:'passed',fixture:'Server-owned test player, three seeded seals for isolated view QA. Full progression tested separately.',errors,overflow},null,2));console.log('Visual fixture passed');
}finally{await browser?.close();await game.close();}
