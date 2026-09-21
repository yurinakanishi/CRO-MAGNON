// Real browser rendering of exact candidate bytes, without adopting them.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createGameServer } from '../dist/server.mjs';
import path from 'node:path';
const { chromium } =
  await import('file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const [key, revision = '01'] = process.argv.slice(2);
const dressed = process.argv.includes('--dressed');
const tag = process.argv.find((arg) => arg.startsWith('--tag='))?.split('=')[1];
if (tag && !/^[a-z0-9-]+$/.test(tag)) throw new Error('Invalid QA tag');
const folder = `output/playwright/${key}/asset-${revision}${dressed ? '-dressed' : ''}${tag ? `-${tag}` : ''}`;
await mkdir(folder, { recursive: true });
const game = createGameServer({ port: 0, host: '127.0.0.1' });
const { port } = await game.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1100, height: 850 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
try {
  await page.route('**/qa-source.glb', async (r) =>
    r.fulfill({
      contentType: 'model/gltf-binary',
      body: await readFile(`assets/${key}/work/revision-${revision}/model.glb`),
    }),
  );
  await page.route('**/qa-pigment.png', async (r) =>
    r.fulfill({
      contentType: 'image/png',
      body: await readFile(
        JSON.parse(await readFile('public/models/camp-cave/asset.json')).pigment.source,
      ),
    }),
  );
  await page.route('**/qa-camp-asset', (r) =>
    r.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><style>body{margin:0}</style><script type="importmap">{"imports":{"three":"/vendor/three.module.js","three/addons/":"/vendor/addons/"}}</script><script type="module">
import * as T from 'three';import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
const r=new T.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});r.setSize(1100,850);r.toneMapping=T.ACESFilmicToneMapping;document.body.append(r.domElement);
const s=new T.Scene();s.background=new T.Color('#8b939b');s.add(new T.HemisphereLight('#ffffff','#6f6353',2));const sun=new T.DirectionalLight('#ffffff',2.7);sun.position.set(2,5,3);s.add(sun);
const model=(await new GLTFLoader().loadAsync('/qa-source.glb')).scene;s.add(model);model.updateMatrixWorld(true);
const fire=new T.PointLight('#ffd6a4',35,16,1.6);fire.position.set(3,2.3,0);fire.visible=false;s.add(fire);
if(${dressed && key === 'camp-cave'}) {const p=await new T.TextureLoader().loadAsync('/qa-pigment.png');p.colorSpace=T.SRGBColorSpace;p.anisotropy=8;const a=await(await fetch('/models/camp-cave/asset.json')).json();const stone=await new T.TextureLoader().loadAsync(a.rockSurface.url);stone.colorSpace=T.SRGBColorSpace;stone.wrapS=stone.wrapT=T.RepeatWrapping;stone.anisotropy=8;const character=await new T.TextureLoader().loadAsync(a.characterPigment.url);character.colorSpace=T.SRGBColorSpace;character.anisotropy=8;(await import('/src/cave-materials.js')).prepareCaveMaterials(model,p,stone,character);}
if(${dressed && key === 'camp-mountain'}) (await import('/src/mountain-materials.js')).prepareMountainMaterials(model);
window.lightFire=(lit,position)=>{fire.visible=lit;if(position){fire.position.set(...position);fire.distance=24;}};
const box=new T.Box3().setFromObject(model),size=box.getSize(new T.Vector3()),centre=box.getCenter(new T.Vector3());
const c=new T.PerspectiveCamera(48,1100/850,.01,1500);const originals=new Map();model.traverse(n=>{if(n.isMesh)originals.set(n,n.material);});
window.review=(direction,clay=false,inside=false,targetPosition)=>{model.traverse(n=>{if(n.isMesh)n.material=clay?new T.MeshStandardMaterial({color:'#a2a2a2',roughness:.85,side:T.FrontSide}):originals.get(n);});const target=targetPosition?new T.Vector3(...targetPosition):inside?new T.Vector3(0,2,0):centre;c.position.copy(inside?new T.Vector3(...direction):centre.clone().add(new T.Vector3(...direction).normalize().multiplyScalar(Math.max(size.x,size.y,size.z)*1.6)));c.lookAt(target);r.render(s,c);return{bounds:{min:box.min.toArray(),max:box.max.toArray()},triangles:r.info.render.triangles};};window.ready=true;
</script>`,
    }),
  );
  await page.goto(`http://127.0.0.1:${port}/qa-camp-asset`);
  await page.waitForFunction(() => window.ready, {}, { timeout: 120000 });
  const results = [];
  for (const [name, dir] of Object.entries({
    front: [0, 0.2, 1],
    back: [0, 0.2, -1],
    left: [-1, 0.2, 0],
    right: [1, 0.2, 0],
    threequarter: [1, 0.55, 1],
    top: [0, 1, 0.001],
  })) {
    for (const clay of [false, true]) {
      results.push({
        name,
        clay,
        ...(await page.evaluate(({ dir, clay }) => review(dir, clay), { dir, clay })),
      });
      await page.screenshot({ path: `${folder}/${name}${clay ? '-clay' : ''}.png` });
    }
  }
  if (key === 'camp-cave') {
    for (const [name, dir] of Object.entries({ entrance: [0, 2.7, 8], wall: [4, 2.8, 1] })) {
      results.push({ name, ...(await page.evaluate((dir) => review(dir, false, true), dir)) });
      await page.screenshot({ path: `${folder}/${name}.png` });
    }
    if (dressed) {
      await page.evaluate(() => {
        lightFire(true);
        review([4, 2.8, 1], false, true);
      });
      await page.screenshot({ path: `${folder}/wall-fire.png` });
      for (const [name, position, target] of [
        ['deep-chamber', [8, 3.3, -20], [16, 3.3, -32.5]],
        ['left-animal-gallery', [15, 3.3, -25.5], [4.5, 3.3, -25.5]],
        ['right-animal-gallery', [4, 3.3, -21.2], [14.5, 3.3, -21.2]],
      ]) {
        results.push({
          name,
          ...(await page.evaluate(
            ({ position, target }) => {
              lightFire(true, [10, 2.3, -20]);
              return review(position, false, true, target);
            },
            { position, target },
          )),
        });
        await page.screenshot({ path: `${folder}/${name}.png` });
      }
      for (const clay of [false, true]) {
        const name = `blind-end${clay ? '-clay' : ''}`;
        results.push({
          name,
          ...(await page.evaluate((clay) => {
            lightFire(true, [10, 2.3, -20]);
            return review([14, 2.7, -28.6], clay, true, [18, 2.5, -36]);
          }, clay)),
        });
        await page.screenshot({ path: `${folder}/${name}.png` });
      }
    }
  }
  await writeFile(
    `${folder}/summary.json`,
    JSON.stringify({ key, revision, results, errors }, null, 2),
  );
  console.log(JSON.stringify({ folder: path.resolve(folder), bounds: results[0].bounds, errors }));
} finally {
  await browser.close();
  await game.close();
}
