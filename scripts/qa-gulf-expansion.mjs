const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
import {createGameServer} from '../dist/server.mjs';
import {createGameCore} from '../dist/application/game-core.mjs';
import {stopActor} from '../dist/shared/combat.mjs';
import {GULF_STOPS,GULF_ENTRY,LANDINGS} from '../dist/shared/gulf-region.mjs';
import {isLand} from '../dist/shared/paleo-geography.mjs';
import {WebSocket} from 'ws';
import {createInterface} from 'node:readline';
import {mkdir,writeFile} from 'node:fs/promises';
const core=createGameCore(),game=createGameServer({core,port:0,host:'127.0.0.1'});
const folder=process.argv[2] || 'output/playwright/gulf-expansion';await mkdir(folder,{recursive:true});
const address=await game.listen(), base=`http://127.0.0.1:${address.port}`;
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--use-angle=d3d11']});
const pages=[],errors=[],peers=[],observations=[],fps=[];
async function addPage(name){
 const context=await browser.newContext({viewport:{width:1440,height:900}});
 await context.addInitScript(({name})=>{localStorage.setItem('cro-name',name);localStorage.setItem('cro-species','nea');localStorage.setItem('cro-gender','female');},{name});
 const page=await context.newPage();pages.push(page);
 page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto(`${base}/?room=SCALE-QA&autostart=1`,{waitUntil:'domcontentloaded'});
 await page.locator('#world[data-world-asset="ready"]').waitFor({timeout:90000});
 return page;
}

const page=await addPage('広い湾A');
await page.screenshot({path:`${folder}/01-ready.png`});
console.log(JSON.stringify({ready:true,errors,ui:(await page.locator('body').ariaSnapshot()).slice(0,4800)}));
const room=()=>core.rooms.get('SCALE-QA');
const actor=(name='広い湾A')=>[...room().players.values()].find(p=>p.name===name);
const sampler=setInterval(()=>{
 const state=core.snapshot(room());observations.push({at:state.serverTime,players:state.players.length,positions:state.players.map(p=>({name:p.name,x:p.x,z:p.z,boatId:p.boatId,free:!!p.boatId||room().collision.free(p,p.radius)}))});
},250);
const rl=createInterface({input:process.stdin});
for await(const line of rl){
 try{
  const q=JSON.parse(line),p=pages[q.page??0];let r;
  if(q.type==='key'){await p.keyboard.press(q.key);r={key:q.key};}
  if(q.type==='click'){await p.locator(q.selector).click({timeout:8000,...(q.position?{position:q.position}:{})});r={clicked:q.selector};}
  if(q.type==='probe')r={ui:await p.locator('body').ariaSnapshot(),errors};
  if(q.type==='compact')r={players:core.snapshot(room()).players.map(p=>({name:p.name,x:p.x,z:p.z,moving:p.moving,boatId:p.boatId,gulf:p.gulf,inventory:p.inventory,onLand:isLand(p.x,p.z)})),boats:core.snapshot(room()).boats,errors};
  if(q.type==='shot'){await p.screenshot({path:`${folder}/${q.file}.png`});fps.push(await p.locator('#world').evaluate(c=>({fps:c.dataset.fps,chunks:c.dataset.terrainChunks,landmarks:c.dataset.landmarks})));r={path:`${folder}/${q.file}.png`};}
  if(q.type==='viewport'){await p.setViewportSize({width:q.width,height:q.height});r={viewport:q};}
  if(q.type==='reload'){await p.reload({waitUntil:'domcontentloaded'});await p.locator('#world[data-world-asset="ready"]').waitFor({timeout:90000});r={reloaded:true};}
  if(q.type==='addPage'){await addPage(q.name);r={pages:pages.length};}
  if(q.type==='addPeers'){
   for(let i=0;i<q.count;i++){
    const s=new WebSocket(`${base.replace('http','ws')}/ws?room=SCALE-QA&name=Peer${i}&species=cro&resume=1`);peers.push(s);
    await new Promise(resolve=>s.once('open',resolve));s.send(JSON.stringify({type:'expedition',destination:GULF_ENTRY.id}));
   }r={peers:peers.length};
  }
  if(q.type==='fixture'){const a=actor(q.name);stopActor(a);if(q.x!==undefined)a.x=q.x;if(q.z!==undefined)a.z=q.z;if(q.inventory)Object.assign(a.inventory,q.inventory);r={fixture:true,name:a.name,x:a.x,z:a.z};}
  if(q.type==='mapMove'){
   await p.keyboard.press('m');await p.locator('#map-gulf').click();
   const canvas=p.locator('#big-map'),box=await canvas.boundingBox(),dims=await canvas.evaluate(c=>({width:c.width,height:c.height}));
   const scale=Math.min((dims.width-24)/1480,(dims.height-28)/1340);
   await canvas.click({position:{x:(dims.width/2+(q.x+2210)*scale)*box.width/dims.width,y:(dims.height/2+(q.z-740)*scale)*box.height/dims.height}});
   await p.locator('#map-walk').click();r={mapMove:{x:q.x,z:q.z}};
  }
  if(q.type==='save'){const report={at:new Date().toISOString(),errors,fps,renderedPages:pages.length,peers:peers.length,samples:observations.length,maxPlayers:Math.max(...observations.map(o=>o.players)),collisionViolations:observations.flatMap(o=>o.positions.filter(p=>!p.free)),state:core.snapshot(room(),true),notes:q.notes};await writeFile(`${folder}/report.json`,JSON.stringify(report,null,2));r={saved:true,errors,samples:observations.length};}
  if(q.type==='quit'){clearInterval(sampler);await browser.close();for(const s of peers)s.close();await game.close();rl.close();console.log('{"closed":true}');process.exit(0);}
  console.log(JSON.stringify(r??{unknown:q}));
 }catch(error){console.log(JSON.stringify({error:String(error)}));}
}

clearInterval(sampler); await browser.close(); for(const s of peers)s.close(); await game.close();
