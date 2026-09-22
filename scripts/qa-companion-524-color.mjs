// Compare the delivered single-texture GLB against the user's exact two-map
// linear-light midpoint preview, under identical geometry, pose and lighting.
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const base = '../threed-model-creation/models/yellow-524-mascot/work/low-poly';
const out = 'output/playwright/companion-524/midpoint-r01/color';
await mkdir(out, { recursive: true });
const files = new Map([
  ['/c13.glb', `${base}/batch-015/run-01/attempt-01/candidate.glb`],
  ['/c14.glb', `${base}/batch-016/run-01/attempt-01/candidate.glb`],
  ['/mid.glb', 'public/models/yellow-524-mascot/model-midpoint-r01.glb'],
]);
const html = `<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><style>body{margin:0}canvas{display:block}</style>
<script type="importmap">{"imports":{"three":"/vendor/three.module.js","three/addons/":"/vendor/addons/"}}</script>
<script type="module">
import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
const loader=new GLTFLoader(), models=await Promise.all(['/c13.glb','/c14.glb','/mid.glb'].map(p=>loader.loadAsync(p)));
let previousMap;models[0].scene.traverse(o=>{if(o.isMesh)previousMap=o.material.map;});
const reference=models[1].scene, delivered=models[2].scene;
reference.traverse(o=>{if(o.isMesh){o.material=o.material.clone();o.material.onBeforeCompile=s=>{
  s.uniforms.previousMap={value:previousMap};s.fragmentShader='uniform sampler2D previousMap;\\n'+s.fragmentShader;
  s.fragmentShader=s.fragmentShader.replace('#include <map_fragment>', '#ifdef USE_MAP\\n diffuseColor *= mix(texture2D(previousMap,vMapUv),texture2D(map,vMapUv),0.5);\\n #endif');
};o.material.customProgramCacheKey=()=> '524-exact-selected-preview';}});
for(const [i,model] of [reference,delivered].entries()){
  const mixer=new T.AnimationMixer(model);mixer.clipAction(models[i+1].animations[0]).play();mixer.setTime(1);model.updateMatrixWorld(true);
}
const scene=new T.Scene();scene.background=new T.Color('#e4e6e9');scene.add(reference,delivered);
scene.add(new T.HemisphereLight('#ffffff','#7a8493',2));
const key=new T.DirectionalLight('#ffffff',2.4);key.position.set(-3,5,4);scene.add(key);
const fill=new T.DirectionalLight('#ffffff',.55);fill.position.set(4,1,-2);scene.add(fill);
const renderer=new T.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(900,900);renderer.setPixelRatio(1);
renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.NeutralToneMapping;renderer.toneMappingExposure=1;document.body.append(renderer.domElement);
const centre=new T.Box3().setFromObject(delivered).getCenter(new T.Vector3());
const camera=new T.OrthographicCamera(-.675,.675,.675,-.675,.01,20);
const gl=renderer.getContext();
window.compare=async angle=>{
  camera.position.copy(centre).add(new T.Vector3(Math.sin(angle)*3,.055,Math.cos(angle)*3));camera.lookAt(centre);
  const pixels=[],images=[];
  for(const which of [0,1]){
    reference.visible=which===0;delivered.visible=which===1;renderer.render(scene,camera);
    const p=new Uint8Array(900*900*4);gl.readPixels(0,0,900,900,gl.RGBA,gl.UNSIGNED_BYTE,p);pixels.push(p);
    images.push(renderer.domElement.toDataURL('image/png').split(',')[1]);
  }
  let max=0,sum=0,changed=0;
  for(let i=0;i<pixels[0].length;i+=4){let hit=false;for(let c=0;c<3;c++){const d=Math.abs(pixels[0][i+c]-pixels[1][i+c]);max=Math.max(max,d);sum+=d;hit||=d>0;}changed+=hit?1:0;}
  return {maxChannelDifference:max,meanChannelDifference:sum/(900*900*3),changedPixels:changed,images};
};
window.ready=true;
</script>`;
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html' }).end(html);
      return;
    }
    const file =
      files.get(url.pathname) ??
      (url.pathname.startsWith('/vendor/') && !url.pathname.includes('..')
        ? path.join('public', url.pathname)
        : null);
    if (!file) {
      res.writeHead(404).end();
      return;
    }
    res
      .writeHead(200, {
        'Content-Type': file.endsWith('.glb') ? 'model/gltf-binary' : 'text/javascript',
      })
      .end(await readFile(file));
  } catch (error) {
    res.writeHead(500).end(String(error));
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const checks = [],
  errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => window.ready, null, { timeout: 60000 });
  for (const [name, angle] of [
    ['front', 0.0333],
    ['right', Math.PI / 2],
    ['back', Math.PI],
    ['left', -Math.PI / 2],
  ]) {
    const { images, ...result } = await page.evaluate((angle) => window.compare(angle), angle);
    await writeFile(`${out}/${name}-reference.png`, Buffer.from(images[0], 'base64'));
    await writeFile(`${out}/${name}-delivered.png`, Buffer.from(images[1], 'base64'));
    assert.ok(result.maxChannelDifference <= 3, `${name}: ${JSON.stringify(result)}`);
    checks.push({ name, ...result });
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ checks, errors }));
  await writeFile(`${out}/result.json`, JSON.stringify({ checks, errors }, null, 2));
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
