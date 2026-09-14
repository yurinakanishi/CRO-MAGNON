import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createGameServer } from '../dist/server.mjs';
const { chromium } =
  await import('file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const folder = 'output/playwright/firewood/asset-r02';
await mkdir(folder, { recursive: true });
const root = 'output/model-generation/models/firewood-log';
const game = createGameServer({ port: 0, host: '127.0.0.1' }),
  { port } = await game.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true }),
  page = await browser.newPage({ viewport: { width: 960, height: 720 } }),
  errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const html = `<!doctype html><html><head><style>body{margin:0}canvas{display:block}</style><script type="importmap">{"imports":{"three":"/vendor/three.module.js","three/addons/":"/vendor/addons/"}}</script></head><body><script type="module">
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {WorldAssets} from '/src/world-assets.js';
import {buildWoodPile} from '/src/wood-pile.js';
const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(960,720);renderer.toneMapping=THREE.ACESFilmicToneMapping;document.body.append(renderer.domElement);
const scene=new THREE.Scene();scene.background=new THREE.Color('#7e858c');scene.add(new THREE.HemisphereLight('#ffffff','#6d645b',2));
const sun=new THREE.DirectionalLight('#ffffff',2.8);sun.position.set(2,4,3);scene.add(sun);
const camera=new THREE.OrthographicCamera(-.9,.9,.675,-.675,.01,30);
const loader=new GLTFLoader(),models={};for(const key of ['dense','candidate','lod1','lod2'])models[key]=await loader.loadAsync('/qa-log-'+key+'.glb');
const report=await(await fetch('/qa-log-report.json')).json();
models.dense.scene.rotation.y=report.alignment.yaw_degrees*Math.PI/180;models.dense.scene.updateMatrixWorld(true);
const denseBox=new THREE.Box3().setFromObject(models.dense.scene), factor=1.2/(denseBox.max.x-denseBox.min.x);
models.dense.scene.scale.setScalar(factor);models.dense.scene.position.set(-(denseBox.max.x+denseBox.min.x)/2*factor,-denseBox.min.y*factor,-(denseBox.max.z+denseBox.min.z)/2*factor);
const assets=new WorldAssets();assets.templates.set('firewood-log',{gltf:models.candidate,lods:[models.lod1,models.lod2],asset:{modelKey:'firewood-log'}});
const perspective=new THREE.PerspectiveCamera(55,960/720,.01,100);
let shown;
window.review=(kind,direction,amount=7,clay=false,distance=0)=>{
 if(shown){scene.remove(shown);shown=null;}
 if(kind==='pile'){const pile=buildWoodPile(assets,7,null);pile.setAmount(amount);shown=pile.root;}
 else shown=models[kind].scene.clone(true);
 if(clay)shown.traverse(n=>{if(n.isMesh)n.material=new THREE.MeshStandardMaterial({color:'#a0a0a0',roughness:.7,side:THREE.FrontSide});});
 scene.add(shown);shown.updateMatrixWorld(true);
 const centre=new THREE.Vector3(0,kind==='pile'?.30:.15,0); const extent=kind==='pile'?1.4:.9; camera.left=-extent;camera.right=extent;camera.top=extent*.75;camera.bottom=-extent*.75;camera.updateProjectionMatrix();
 const active=distance?perspective:camera;
 active.position.copy(centre).add(new THREE.Vector3(...direction).normalize().multiplyScalar(distance||4));active.lookAt(centre);renderer.render(scene,active);
 const counts=[];shown.traverse(n=>{if(n.isInstancedMesh)counts.push(n.count);});
 return {kind,amount,clay,counts,distance,level:shown.isLOD?shown.getCurrentLevel():null,calls:renderer.info.render.calls,triangles:renderer.info.render.triangles};
};window.ready=true;
</script></body></html>`;
try {
  await page.route('**/qa-firewood-asset', (r) =>
    r.fulfill({ contentType: 'text/html', body: html }),
  );
  await page.route('**/qa-log-*.glb', async (r) => {
    const key = /qa-log-(\w+)\.glb/.exec(r.request().url())[1];
    const path =
      key === 'dense'
        ? root + '/work/trellis/dense-res1024-seed0042.glb'
        : root + '/work/low-poly/candidate-02/' + key + '.glb';
    await r.fulfill({ contentType: 'model/gltf-binary', body: await readFile(path) });
  });
  await page.route('**/qa-log-report.json', async (r) =>
    r.fulfill({
      contentType: 'application/json',
      body: await readFile(root + '/work/low-poly/candidate-02/process-report.json'),
    }),
  );
  await page.goto('http://127.0.0.1:' + port + '/qa-firewood-asset');
  await page.waitForFunction(() => window.ready, {}, { timeout: 120000 });
  const results = [];
  const views = {
    end: [1, 0.12, 0],
    back: [-1, 0.12, 0],
    side: [0, 0.12, 1],
    rear: [0, 0.12, -1],
    threequarter: [1, 0.6, 1],
    top: [0, 1, 0.001],
    bottom: [0, -1, 0.001],
  };
  for (const kind of ['dense', 'candidate', 'lod1', 'lod2'])
    for (const [view, direction] of Object.entries(views))
      for (const clay of kind === 'candidate' ? [false, true] : [false]) {
        const result = await page.evaluate(
          ({ kind, direction, clay }) => review(kind, direction, 7, clay),
          { kind, direction, clay },
        );
        results.push({ view, ...result });
        await page.screenshot({
          path: folder + '/' + kind + '-' + view + (clay ? '-clay' : '') + '.png',
        });
      }
  for (const amount of [7, 6, 5, 4, 3, 2, 1, 0]) {
    results.push(await page.evaluate((amount) => review('pile', [1, 0.75, 1], amount), amount));
    await page.screenshot({ path: folder + '/pile-' + amount + '.png' });
  }
  for (const distance of [9, 12, 21, 26]) {
    const result = await page.evaluate(
      (distance) => review('pile', [1, 0.3, 1], 7, false, distance),
      distance,
    );
    assert.equal(result.level, distance < 10 ? 0 : distance < 22 ? 1 : 2);
    results.push(result);
    await page.screenshot({ path: `${folder}/distance-${distance}.png` });
  }
  assert.deepEqual(errors, []);
  await writeFile(folder + '/summary.json', JSON.stringify({ results, errors }, null, 2));
  console.log('asset views saved', results.length);
} finally {
  await browser.close();
  game.close();
}
