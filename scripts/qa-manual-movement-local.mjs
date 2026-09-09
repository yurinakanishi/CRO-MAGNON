// Ordinary input against the running local game; no world or inventory fixtures.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const {chromium}=await import('file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const out='output/playwright/manual-movement-20260909/local';await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[],commands=[],states=[],checks=[];
let id;
try{
 page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 page.on('websocket',s=>{s.on('framesent',e=>commands.push(JSON.parse(e.payload.toString())));s.on('framereceived',e=>{const m=JSON.parse(e.payload.toString());if(m.type==='welcome')id=m.id;if(m.type==='state')states.push(m);});});
 const current=()=>states.at(-1)?.players.find(p=>p.id===id),position=()=>({x:current().x,z:current().z});
 await page.goto('http://localhost:3000/?room=MANUAL-LOCAL');await page.locator('#title-start').click();await page.locator('#setup-form input[name="name"]').fill('Manual local QA');await page.locator('#setup-submit').click();await page.locator('#guide-start').click();
 await page.waitForSelector('#world[data-world-asset="ready"][data-character-asset="ready"]',{timeout:60000});
 const origin=position();await page.locator('#world').click({position:{x:720,y:590}});await page.waitForTimeout(350);assert.deepEqual(position(),origin);await page.keyboard.press('r');await page.waitForTimeout(250);assert.deepEqual(position(),origin);assert.ok(!current().mountId);
 await page.keyboard.press('m');await page.locator('#map-location').selectOption('sahul');await page.locator('#map-camp').click();assert.equal(await page.locator('#map-walk,#map-expedition').count(),0);await page.locator('#modal-close').click();await page.waitForTimeout(250);assert.deepEqual(position(),origin);
 await page.locator('#world').focus();await page.keyboard.down('w');await page.waitForTimeout(500);await page.keyboard.up('w');await page.waitForTimeout(200);assert.ok(Math.hypot(current().x-origin.x,current().z-origin.z)>.1);const stopped=position();await page.waitForTimeout(400);assert.deepEqual(position(),stopped);checks.push('3000: ground, distant R and map do not move; W moves and releasing stops');
 for(const viewport of [{width:390,height:844},{width:844,height:390}]){await page.setViewportSize(viewport);await page.keyboard.press('m');await page.screenshot({path:out+'/map-'+viewport.width+'x'+viewport.height+'.png'});await page.locator('#modal-close').click();assert.deepEqual(position(),stopped);}
 await page.reload();await page.waitForSelector('#title-continue',{state:'visible'});await page.locator('#title-continue').click();await page.waitForSelector('#world[data-world-asset="ready"][data-character-asset="ready"]',{timeout:60000});assert.deepEqual(position(),stopped);checks.push('3000: portrait/landscape map and reload preserve position');
 assert.equal(commands.filter(c=>['target','expedition'].includes(c.type)).length,0);assert.deepEqual(errors,[]);
 await page.keyboard.press('Escape');await page.locator('[data-controller-menu="title"]').click();
 console.log('PASS '+checks.join('; ')+'; zero browser errors and retired travel commands');
}finally{await writeFile(out+'/summary.json',JSON.stringify({checks,errors,fixtures:'None: ordinary title/setup, keys and map UI in a separate QA room.'},null,2));await browser.close();}
