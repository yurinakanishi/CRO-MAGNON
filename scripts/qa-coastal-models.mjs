// Exact GLB browser comparison; no production geometry is generated here.
import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from 'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const root = resolve('.'),
  config = JSON.parse(await readFile(process.argv[2], 'utf8')),
  out = resolve(config.out);
await mkdir(out, { recursive: true });
const html = `<!doctype html><html><head><style>body{margin:0;background:#e6e8e9;color:#25343a;font:16px sans-serif}main{display:flex}section{width:400px}h3{text-align:center}canvas{display:block}</style><script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js","three/addons/":"/node_modules/three/examples/jsm/"}}</script></head><body><main></main><script type="module">
import * as T from 'three';import{GLTFLoader}from 'three/addons/loaders/GLTFLoader.js';
const records=${JSON.stringify(config.records)};const views=[];
for(const [title,url]of records){const el=document.createElement('section');el.innerHTML='<h3>'+title+'</h3>';document.querySelector('main').append(el);const renderer=new T.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(400,500);renderer.setPixelRatio(1);renderer.outputColorSpace=T.SRGBColorSpace;el.append(renderer.domElement);const scene=new T.Scene();scene.background=new T.Color('#e6e8e9');scene.add(new T.HemisphereLight(0xffffff,0x76828b,2));const light=new T.DirectionalLight(0xffffff,2.4);light.position.set(-3,6,5);scene.add(light);const model=(await new GLTFLoader().loadAsync(url)).scene;scene.add(model);const box=new T.Box3().setFromObject(model),size=box.getSize(new T.Vector3()),centre=box.getCenter(new T.Vector3());const camera=new T.PerspectiveCamera(34,.8,.001,100);const materials=[];model.traverse(o=>{if(o.isMesh)materials.push([o,o.material]);});views.push({renderer,scene,camera,centre,span:Math.max(size.x,size.y,size.z),materials,bounds:{min:box.min.toArray(),max:box.max.toArray()}});}
window.inspect=(yaw,pitch,clay)=>{for(const v of views){for(const[o,m]of v.materials)o.material=clay?(o.userData.clay??=new T.MeshStandardMaterial({color:'#b7bdc4',roughness:.83,side:T.DoubleSide})):m;const r=v.span*2.3;v.camera.position.copy(v.centre).add(new T.Vector3(Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),Math.cos(yaw)*Math.cos(pitch)).multiplyScalar(r));v.camera.lookAt(v.centre);v.renderer.render(v.scene,v.camera);}return views.map(v=>v.bounds);};window.inspect(.8,.65,false);window.ready=true;
</script></body></html>`;
const server = http.createServer(async (req, res) => {
  try {
    if (req.url === '/') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(html);
      return;
    }
    const file = resolve(root, '.' + decodeURIComponent(req.url.split('?')[0]));
    if (relative(root, file).startsWith('..')) throw Error('Outside workspace');
    const bytes = await readFile(file);
    res.setHeader(
      'Content-Type',
      file.endsWith('.js')
        ? 'text/javascript'
        : file.endsWith('.glb')
          ? 'model/gltf-binary'
          : 'application/octet-stream',
    );
    res.end(bytes);
  } catch {
    res.statusCode = 404;
    res.end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
let browser;
try {
  browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  });
  const page = await browser.newPage({
    viewport: { width: 400 * config.records.length, height: 560 },
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('http://127.0.0.1:' + server.address().port);
  await page.waitForFunction(() => window.ready, {}, { timeout: 60000 });
  let bounds;
  for (const [name, yaw, pitch] of [
    ['front', 0, 0.25],
    ['rear', Math.PI, 0.25],
    ['left', -Math.PI / 2, 0.25],
    ['right', Math.PI / 2, 0.25],
    ['quarter', 0.8, 0.65],
    ['top', 0, 1.5],
    ['bottom', 0, -1.2],
  ])
    for (const clay of [false, true]) {
      bounds = await page.evaluate(([y, p, c]) => window.inspect(y, p, c), [yaw, pitch, clay]);
      await page.screenshot({ path: resolve(out, name + (clay ? '-clay' : '') + '.png') });
    }
  const files = [];
  for (const [label, url] of config.records) {
    const b = await readFile(resolve(root, '.' + url));
    files.push({
      label,
      url,
      sha256: createHash('sha256').update(b).digest('hex'),
      bytes: b.length,
    });
  }
  await writeFile(
    resolve(out, 'browser.json'),
    JSON.stringify({ bounds, errors, views: 14, files }, null, 2),
  );
  console.log(JSON.stringify({ bounds, errors, views: 14 }));
  if (errors.length) throw Error('Browser errors');
} finally {
  await browser?.close();
  await new Promise((r) => server.close(r));
}
