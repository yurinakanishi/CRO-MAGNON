// Exact delivered characters and firewood, reviewed under neutral lighting.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createGameServer } from '../dist/server.mjs';
import { CHARACTER_MODELS } from '../dist/shared/characters.mjs';
const { chromium } =
  await import('file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const before = process.argv.includes('--before');
const out = `output/torch-hold/${before ? 'before' : 'review'}-${Date.now()}`;
await mkdir(out, { recursive: true });
const game = createGameServer({ host: '127.0.0.1', port: 0 });
const { port } = await game.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 1536 } });
const errors = [],
  records = [];
let failure;
page.on('pageerror', (e) => errors.push(String(e)));
const html = `<!doctype html><meta charset="utf-8"><title>Torch hold review</title>
<style>body{margin:0;background:#d8e1e0;font:15px sans-serif;color:#172c2a}h1{margin:10px;font-size:18px}#grid{display:grid;grid-template-columns:repeat(4,320px)}figure{margin:0;position:relative}figcaption{position:absolute;left:8px;top:8px;background:#fffc;padding:4px}canvas{display:block}</style>
<h1 id="title"></h1><div id="grid"></div>
<script type="importmap">{"imports":{"three":"/vendor/three.module.js","three/addons/":"/vendor/addons/"}}</script>
<script type="module">
import * as THREE from 'three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { CharacterAssets } from '/src/character-assets.js';
import { loadVerifiedGLB } from '/src/world-assets.js';
import { updateActorPerformance } from '/src/performance-lod.js';
import { CaveTorch } from '/src/${before ? 'cave-torch-review-before' : 'cave-torch'}.js';
const renderer = new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
renderer.setSize(320,360);renderer.setPixelRatio(1);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;
const scene=new THREE.Scene();scene.background=new THREE.Color('#d8e1e0');scene.add(new THREE.HemisphereLight(0xffffff,0x66766b,2.5));
const sun=new THREE.DirectionalLight(0xfff5e7,3);sun.position.set(3,5,4);scene.add(sun);
const camera=new THREE.PerspectiveCamera(34,320/360,.01,100);
const logAsset=await (await fetch('/models/firewood-log/asset.json')).json();
const log=await loadVerifiedGLB(logAsset.lods[0]);
const assets={create:()=>clone(log.scene)};
let provider,actor,torch;
window.review=async(key,lod=false)=>{
 if(actor){torch.dispose();scene.remove(actor.root);provider.dispose();}
 provider=new CharacterAssets('/models/'+key+'/asset.json');actor=await provider.create({color:'#78ab72'});scene.add(actor.root);
 torch=new CaveTorch(scene,assets,actor.root,actor.asset.heightMetres);
 const h=actor.asset.heightMetres;
 document.querySelector('#title').textContent=key+' / ${before ? 'BEFORE' : 'AFTER'} / '+(lod?'LOD':'primary');document.querySelector('#grid').replaceChildren();
 const data=[];
 for(const [clip,time,close] of [['Idle_Loop',.25,false],['Walk_Loop',.25,false],['Run_Loop',.45,false],['Idle_Loop',.6,true]]){
  torch.pose.restore();actor.animation.mixer.stopAllAction();
  const action=actor.animation.actions.get(clip);action.reset().setEffectiveWeight(1).setEffectiveTimeScale(1).play();action.time=time;actor.animation.mixer.update(0);updateActorPerformance(actor.root,lod?45:3,'standard');
  torch.update(true,1,1,1);torch.light.intensity=0;
  const point=n=>actor.root.getObjectByName(n).getWorldPosition(new THREE.Vector3());
  const shoulder=point('UpperArmL'),elbow=point('LowerArmL'),wrist=point('HandL'),grip=point('GripL');
  data.push({clip,time,shoulder:shoulder.toArray(),elbow:elbow.toArray(),wrist:wrist.toArray(),grip:grip.toArray(),torch:torch.root.position.toArray()});
  for(const [name,angle] of [['front',.3],['left',Math.PI/2],['back',Math.PI-.3],['right',-Math.PI/2]]){
   const target=close?shoulder.clone().lerp(grip,.5):new THREE.Vector3(0,h*.56,0);if(close)target.y+=h*.035;
   const distance=h*(close?1.06:2.5);camera.position.copy(target).add(new THREE.Vector3(Math.sin(angle)*distance,h*.04,Math.cos(angle)*distance));camera.lookAt(target);renderer.render(scene,camera);
   const figure=document.createElement('figure'),canvas=document.createElement('canvas'),caption=document.createElement('figcaption');canvas.width=320;canvas.height=360;canvas.getContext('2d').drawImage(renderer.domElement,0,0);caption.textContent=(close?'hand close':clip)+' / '+name;figure.append(canvas,caption);document.querySelector('#grid').append(figure);
  }
 }
 window.gripReview=(weight)=>{
  torch.grasp.update(weight);document.querySelector('#grid').replaceChildren();
  for(const [name,angle] of [['front',.3],['left',Math.PI/2],['back',Math.PI-.3],['right',-Math.PI/2]]){
   const target=torch.pose.grip.getWorldPosition(new THREE.Vector3());
   camera.position.copy(target).add(new THREE.Vector3(Math.sin(angle)*h*.3,h*.035,Math.cos(angle)*h*.3));camera.lookAt(target);renderer.render(scene,camera);
   const figure=document.createElement('figure'),canvas=document.createElement('canvas'),caption=document.createElement('figcaption');canvas.width=320;canvas.height=360;canvas.getContext('2d').drawImage(renderer.domElement,0,0);caption.textContent='curl '+weight+' / '+name;figure.append(canvas,caption);document.querySelector('#grid').append(figure);
  }
  const meshes=[];actor.root.traverse(mesh=>{if(mesh.isSkinnedMesh)meshes.push({name:mesh.name,morphs:mesh.morphTargetDictionary,influences:mesh.morphTargetInfluences,attributes:Object.keys(mesh.geometry.morphAttributes),changed:mesh.geometry.morphAttributes.position?.at(-1)?.array.filter(v=>Math.abs(v)>1e-8).length});});return{meshes,normal:torch.grasp.normal.toArray(),centre:torch.grasp.centre,radius:torch.grasp.radius,baseY:torch.grasp.baseY};
 };
 return data;
};window.ready=true;
</script>`;
try {
  if (before) {
    const code = await readFile('output/torch-hold/cave-torch-before.js', 'utf8');
    await page.route('**/src/cave-torch-review-before.js', (route) =>
      route.fulfill({ contentType: 'text/javascript', body: code }),
    );
  }
  await page.route('**/__torch-review', (route) =>
    route.fulfill({ contentType: 'text/html', body: html }),
  );
  await page.goto(`http://127.0.0.1:${port}/__torch-review`);
  await page.waitForFunction(() => window.ready, null, { timeout: 60000 });
  const keys = process.env.TORCH_KEYS?.split(',') ?? CHARACTER_MODELS.map((c) => c.key);
  for (const key of keys)
    for (const lod of process.argv.includes('--lod') ? [false, true] : [false]) {
      const suffix = lod ? '-lod' : '';
      const samples = await page.evaluate(({ key, lod }) => window.review(key, lod), { key, lod });
      await page.screenshot({ path: `${out}/${key}${suffix}.png`, fullPage: true });
      records.push({ key, lod, samples });
      if (process.argv.includes('--grip'))
        for (const weight of [0, 1]) {
          const grip = await page.evaluate((weight) => window.gripReview(weight), weight);
          await page
            .locator('#grid')
            .screenshot({ path: `${out}/${key}${suffix}-grip-${weight}.png` });
          records.push({ key, lod, weight, grip });
        }
      console.log('REVIEW', key, lod ? 'LOD' : 'primary');
    }
  assert.deepEqual(errors, []);
} catch (error) {
  failure = String(error.stack ?? error);
  console.error(failure);
} finally {
  await writeFile(
    `${out}/report.json`,
    JSON.stringify({ ok: !failure, failure, records, errors }, null, 2),
  );
  await browser.close();
  await game.close();
  console.log('Evidence:', out);
}
if (failure) process.exitCode = 1;
