// Exact delivered character meshes, mixer and gesture layer, sampled on a review stage.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createGameServer } from '../dist/server.mjs';
import { CHARACTER_MODELS } from '../dist/shared/characters.mjs';
const { chromium } =
  await import('file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const out = process.env.GESTURE_REVIEW_OUT ?? `output/playwright/bot-gestures/review-${Date.now()}`;
await mkdir(out, { recursive: true });
const game = createGameServer({ port: 0, host: '127.0.0.1' });
const { port } = await game.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [],
  records = [];
page.on('pageerror', (e) => errors.push(String(e)));
const html = `<!doctype html><meta charset="utf-8"><title>Bot gesture review</title>
<style>body{margin:0;background:#dae2e0;font:16px sans-serif;color:#182b2a}h1{margin:12px;font-size:20px}#grid{display:grid;grid-template-columns:repeat(4,320px)}figure{margin:0;position:relative}figcaption{position:absolute;left:10px;top:10px;background:#fff9;padding:4px}canvas{display:block}</style>
<h1 id="title"></h1><div id="grid"></div>
<script type="importmap">{"imports":{"three":"/vendor/three.module.js","three/addons/":"/vendor/addons/"}}</script>
<script type="module">
import * as THREE from 'three';
import { CharacterAssets } from '/src/character-assets.js';
import { updateActorPerformance } from '/src/performance-lod.js';
import { CHARACTER_MODELS } from '/shared/characters.mjs';
const renderer = new THREE.WebGLRenderer({ antialias:true, preserveDrawingBuffer:true });
renderer.setSize(320,400); renderer.setPixelRatio(1); renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.toneMapping=THREE.ACESFilmicToneMapping;
const scene = new THREE.Scene(); scene.background=new THREE.Color('#dae2e0');
scene.add(new THREE.HemisphereLight(0xffffff,0x737d76,2.5));
const light=new THREE.DirectionalLight(0xfff4dd,3);light.position.set(3,5,4);scene.add(light);
const floor=new THREE.Mesh(new THREE.PlaneGeometry(30,30),new THREE.MeshStandardMaterial({color:0xaab6ae,roughness:1}));floor.rotation.x=-Math.PI/2;floor.position.y=-.015;scene.add(floor);
const camera=new THREE.PerspectiveCamera(32,320/400,.01,100);
let asset,actor,group;
window.review=async(key,gesture,lod=false)=>{
 if(asset){scene.remove(group);asset.dispose();}
 asset=new CharacterAssets('/models/'+key+'/asset.json'); actor=await asset.create({color:'#78ab72'});
 group=new THREE.Group();group.add(actor.root);scene.add(group);
 const profile=CHARACTER_MODELS.find(m=>m.key===key);const player={...profile,id:'review',x:0,z:0,facing:0,attackSequence:0};
 const height=actor.asset.heightMetres;
 const times=gesture==='throw'?[0,140,260,420]:[0,240,650,980];
 document.querySelector('#title').textContent=key+' / '+gesture+' / '+(lod?'LOD':'primary');
 document.querySelector('#grid').replaceChildren();const data=[];
 for(const angle of [.35,1.6])for(const t of times){
  actor.orbBotPose.restore();actor.orbBotPose.update(undefined,player,0,group);
  actor.animation.current.time=.6;actor.animation.mixer.update(0);
  updateActorPerformance(actor.root,lod?40:4);
  const bot={id:'review-bot',mode:t<=260?'windup':'airborne',throwAt:10000,recallAt:gesture==='call'?10000:0};
  if(gesture==='call')bot.mode='following';
  actor.orbBotPose.update(bot,player,10000+t,group);
  const distance=height*(profile.species==='maruimo'?3.8:2.65);
  camera.position.set(Math.sin(angle)*distance,height*.7,Math.cos(angle)*distance);camera.lookAt(0,height*.52,0);
  renderer.render(scene,camera);
  const figure=document.createElement('figure'),canvas=document.createElement('canvas'),caption=document.createElement('figcaption');
  canvas.width=320;canvas.height=400;canvas.getContext('2d').drawImage(renderer.domElement,0,0);
  caption.textContent=(angle<1?'front':'side')+' / '+t+' ms';figure.append(canvas,caption);document.querySelector('#grid').append(figure);
  data.push({angle,t,weight:actor.orbBotPose.weight,gesture:actor.orbBotPose.gesture,hand:actor.orbBotPose.contact.toArray(),target:actor.orbBotPose.requested.toArray()});
 }
 return data;
};
window.ready=true;
</script>`;
try {
  await page.route('**/__bot-motion', (route) =>
    route.fulfill({ contentType: 'text/html', body: html }),
  );
  await page.goto(`http://127.0.0.1:${port}/__bot-motion`);
  await page.waitForFunction(() => window.ready);
  for (const model of CHARACTER_MODELS) {
    for (const lod of [false, true])
      for (const gesture of ['throw', 'call']) {
        const samples = await page.evaluate(
          ([key, gesture, lod]) => window.review(key, gesture, lod),
          [model.key, gesture, lod],
        );
        await page.screenshot({ path: `${out}/${model.key}-${gesture}${lod ? '-lod' : ''}.png` });
        records.push({ key: model.key, gesture, lod, samples });
      }
    console.log('REVIEW', model.key);
  }
  assert.deepEqual(errors, []);
} finally {
  await writeFile(`${out}/result.json`, JSON.stringify({ records, errors }, null, 2));
  console.log('EVIDENCE', out);
  await browser.close();
  await game.close();
}
