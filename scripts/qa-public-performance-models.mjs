import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { MIME } from '../dist/infrastructure/node/static-files.mjs';
const { chromium } =
  await import('file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const out = process.env.PERF_REVIEW_OUT ?? 'output/playwright/low-spec/models-r02';
await mkdir(out, { recursive: true });
const html = `<!doctype html><meta charset="utf-8"><title>Public asset comparison</title>
<style>body{margin:0;background:#dce2df;font:16px sans-serif}#views{display:grid;grid-template-columns:repeat(4,300px)}figure{margin:0;position:relative}figcaption{position:absolute;left:8px;top:8px;background:#fffd;padding:4px}canvas{display:block}</style>
<h1 id="title"></h1><div id="views"></div>
<script type="importmap">{"imports":{"three":"/vendor/three.module.js","three/addons/":"/vendor/addons/"}}</script>
<script type="module">
import * as T from 'three';import {loadVerifiedGLB,WorldAssets} from '/src/world-assets.js';import{updateActorPerformance}from'/src/performance-lod.js';
const renderer=new T.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(300,360);renderer.setPixelRatio(1);renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;
const scene=new T.Scene();scene.background=new T.Color('#dce2df');scene.add(new T.HemisphereLight(0xffffff,0x798778,2));const sun=new T.DirectionalLight(0xfff4e0,3);sun.position.set(-3,5,4);scene.add(sun);const camera=new T.PerspectiveCamera(34,300/360,.001,100);
const point=new T.Vector3();
window.review=async(key)=>{
 const original=await fetch('/original/models/'+key+'/asset.json').then(r=>r.json()),asset=await fetch('/models/'+key+'/asset.json').then(r=>r.json());
 const [high,opt,low]=await Promise.all([loadVerifiedGLB({...original,url:'/original'+original.url}),loadVerifiedGLB(asset),asset.lods?.[0]?loadVerifiedGLB(asset.lods[0]):null]);
 const bank=new WorldAssets();bank.templates.set('original',{gltf:high,lods:[],asset:original});bank.templates.set(key,{gltf:opt,lods:low?[low]:[],asset});
 const actors=[bank.createAnimal('original',high.animations[0].name),bank.createAnimal(key,opt.animations[0].name)];actors.forEach(a=>scene.add(a.root));
 document.querySelector('#title').textContent=key+' — original / public / LOD';document.querySelector('#views').replaceChildren();
 const record={key,clips:[],bounds:[]};
 for(const clip of ${process.env.PERF_REVIEW_POSES === '0' ? '[]' : 'high.animations'}){
  const entry={clip:clip.name,samples:0,maxBoundsDifference:0};
  for(let frame=0;frame<=Math.ceil(clip.duration*30);frame++){
   const time=Math.min(clip.duration,frame/30);const boxes=[];
   for(const [i,a]of actors.entries()){
    a.sampleOnce(clip.name,time);updateActorPerformance(a.root,i?100:0);a.root.updateMatrixWorld(true);
    const box=new T.Box3();a.root.traverse(n=>{if(!n.isMesh||n.userData.shadowOnly)return;for(let v=0;v<n.geometry.attributes.position.count;v++){n.getVertexPosition(v,point);point.applyMatrix4(n.matrixWorld);if(!Number.isFinite(point.lengthSq()))throw Error('nonfinite vertex');box.expandByPoint(point);}});boxes.push(box);
   }
   entry.maxBoundsDifference=Math.max(entry.maxBoundsDifference,boxes[0].min.distanceTo(boxes[1].min),boxes[0].max.distanceTo(boxes[1].max));entry.samples++;
  }record.clips.push(entry);
 }
 const centre=new T.Box3().setFromObject(actors[0].root).getCenter(new T.Vector3());const size=new T.Box3().setFromObject(actors[0].root).getSize(new T.Vector3()).length();
 for(const angle of [0,Math.PI/2,Math.PI,Math.PI*1.5])for(const [i,label,distance]of [[0,'original',0],[1,'public',0],[1,'LOD',100]]){
  actors.forEach((a,j)=>a.root.visible=j===i);const a=actors[i];a.sampleOnce(high.animations[0].name,.5);updateActorPerformance(a.root,distance);camera.position.copy(centre).add(new T.Vector3(Math.sin(angle)*size*1.7,size*.1,Math.cos(angle)*size*1.7));camera.lookAt(centre);renderer.render(scene,camera);
  const fig=document.createElement('figure'),canvas=document.createElement('canvas'),cap=document.createElement('figcaption');canvas.width=300;canvas.height=360;canvas.getContext('2d').drawImage(renderer.domElement,0,0);cap.textContent=label+' / '+Math.round(angle*180/Math.PI)+'°';fig.append(canvas,cap);document.querySelector('#views').append(fig);
 }
 actors.forEach(a=>scene.remove(a.root));bank.dispose();return record;
};window.ready=true;
</script>`;
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/') return res.writeHead(200, { 'Content-Type': 'text/html' }).end(html);
    const original = url.pathname.startsWith('/original/');
    const base = path.resolve(original ? 'public' : 'dist-cloudflare');
    const file = path.resolve(base, url.pathname.slice(original ? 10 : 1));
    if (path.relative(base, file).startsWith('..')) return res.writeHead(403).end();
    const bytes = await readFile(file);
    res
      .writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' })
      .end(bytes);
  } catch (e) {
    res.writeHead(404).end(String(e));
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ channel: 'chrome', headless: true }),
  page = await browser.newPage({ viewport: { width: 1200, height: 1180 } }),
  errors = [],
  records = [];
page.on('pageerror', (e) => errors.push(String(e)));
try {
  await page.goto('http://127.0.0.1:' + server.address().port);
  await page.waitForFunction(() => window.ready);
  for (const key of process.env.PERF_REVIEW_KEYS?.split(',') ?? [
    'yellow-524-mascot',
    'rimo-neko',
    'orb-bot-beret',
    'orb-bot-frog',
    'orb-bot-triangle',
    'orb-bot-heart',
  ]) {
    console.log('review', key);
    const record = await page.evaluate((key) => review(key), key);
    records.push(record);
    await page.screenshot({ path: out + '/' + key + '.png', fullPage: true });
    assert.ok(
      record.clips.every((c) => c.maxBoundsDifference < 0.025),
      key + ' animation envelope changed > 2.5 cm',
    );
  }
  assert.deepEqual(errors, []);
  await writeFile(out + '/result.json', JSON.stringify({ records, errors }, null, 2));
  console.log(
    process.env.PERF_REVIEW_POSES === '0'
      ? 'PASS public models, visual review at four viewing directions'
      : 'PASS public models, full vertices at 30 Hz, four viewing directions',
  );
} catch (e) {
  await writeFile(
    out + '/failure.json',
    JSON.stringify({ error: String(e), records, errors }, null, 2),
  );
  throw e;
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
}
