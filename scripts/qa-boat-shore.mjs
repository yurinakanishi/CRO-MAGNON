import {createGameServer} from '../server.mjs';
import {chromium} from 'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {launchPoint} from '../dist/shared/boats.mjs';
const game=createGameServer({port:0,host:'127.0.0.1'}),address=await game.listen();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let browser;
try{
  browser=await chromium.launch({channel:'chrome',headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(String(e)));
  await page.addInitScript(()=>{localStorage.setItem('cro-name','Shore route QA');localStorage.setItem('cro-species','cro');localStorage.setItem('cro-gender','female');});
  await page.goto(`http://127.0.0.1:${address.port}/?room=SHORE-QA`);
  await page.waitForSelector('#world[data-world-asset="ready"][data-character-asset="ready"]',{timeout:60000});
  const room=game.rooms.get('SHORE-QA'),p=[...room.players.values()][0],start={x:p.x,z:p.z};
  // Only inventory is supplied by the fixture; the start and complete route are normal gameplay.
  p.inventory.wood=12;
  await page.click('#boat-shore');await sleep(1000);
  const goal=p.navigationGoal&&{...p.navigationGoal};
  console.log(JSON.stringify({start,goal,target:p.target,path:p.path.length}));
  const end=Date.now()+60000;
  while(!launchPoint(room,p)&&Date.now()<end)await sleep(200);
  console.log(JSON.stringify({final:{x:p.x,z:p.z},goal:p.navigationGoal,target:p.target,path:p.path,speed:p.speed,running:p.running,coast:launchPoint(room,p)}));
  assert.ok(launchPoint(room,p),'The shore button must reach a usable coast from the normal spawn');
  await page.click('#boat-craft');await sleep(700);
  assert.equal(room.boats.length,1);assert.equal(p.inventory.wood,0);
  await page.click('#boat-board');await sleep(700);assert.ok(p.boatId);
  await page.screenshot({path:'assets/boat/game-qa/r02/08-natural-shore-route.png'});
  assert.equal(errors.length,0,errors.join('\n'));
  const report={status:'passed',start,goal,shore:room.boats[0].shore,boat:room.boats[0].mooring,fixture:'12 wood supplied; normal spawn and actual walking route via shore button',errors};
  await writeFile('assets/boat/shore-route-qa.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser?.close();await game.close();}
