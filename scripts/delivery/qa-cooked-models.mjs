// Browser QA of cooked delivery GLBs against their masters, in real Chrome with the game's own
// Three r185 GLTFLoader and meshopt decoder.
//
// For every model: both files are parsed; scene graph, material and clip structure must match;
// each scene is rendered from four directions with identical cameras and lighting and the images
// compared; every skinned mesh is posed at five times of every clip and its skinned vertex
// positions compared with the master's. Images of the worst views are written for review.
//
//   node scripts/delivery/qa-cooked-models.mjs [--out output/delivery-qa/<run>] [model-key ...]
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deliveryGraph } from './delivery-graph.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
const out = path.resolve(
  root,
  outIndex >= 0 ? args.splice(outIndex, 2)[1] : `output/delivery-qa/run-${Date.now()}`,
);
const only = new Set(args.filter((arg) => !arg.startsWith('--')));
await mkdir(out, { recursive: true });

const catalog = JSON.parse(
  await readFile(path.join(root, 'public/models/world-assets.json'), 'utf8'),
);
const assets = [...catalog.assets];
const { readdir } = await import('node:fs/promises');
for (const entry of await readdir(path.join(root, 'public/models'), { withFileTypes: true })) {
  if (!entry.isDirectory() || assets.some((asset) => asset.modelKey === entry.name)) continue;
  try {
    const asset = JSON.parse(
      await readFile(path.join(root, 'public/models', entry.name, 'asset.json'), 'utf8'),
    );
    if (typeof asset.url === 'string') assets.push(asset);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
const selected = assets.filter((asset) => !only.size || only.has(asset.modelKey));
const { deliveries } = await deliveryGraph(root, selected);
const pairs = [];
for (const asset of selected)
  for (const record of [asset, ...(asset.lods ?? [])]) {
    const delivery = deliveries.get(record.url);
    if (!delivery?.cooked || pairs.some((pair) => pair.master === record.url)) continue;
    pairs.push({
      key: asset.modelKey,
      master: record.url,
      cooked: delivery.url,
      file: delivery.file,
      // A packed delivery holds this master's only scene as scene `scene`.
      scene: delivery.scene ?? null,
    });
  }

const files = new Map(pairs.map((pair) => [pair.cooked, pair.file]));
const page = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#202020">
<canvas id="c" width="384" height="384"></canvas>
<script type="importmap">{"imports":{"three":"/vendor/three.module.js","three/addons/":"/vendor/addons/"}}</script>
<script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('c'), antialias: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const load = (url) => loader.loadAsync(url);
function structure(gltf, only = null) {
  const nodes = [];
  gltf.scenes.forEach((scene, s) => (only === null || s === only) && scene.traverse((o) => nodes.push([only === null ? s : 0, o.type, only === null ? o.name : o.name.replace(/_\\d+$/, ''), o.isMesh ? o.geometry.attributes.position.count : 0, o.isMesh ? (o.geometry.index?.count ?? 0) : 0, o.isMesh ? Object.keys(o.geometry.attributes).sort().join() : '', o.isMesh ? [o.material].flat().map((m) => m.type + ':' + Object.keys(m).filter((k) => m[k]?.isTexture).sort().join('+')).join() : ''])));
  return JSON.stringify({ nodes, clips: gltf.animations.map((c) => [c.name, c.duration.toFixed(4), c.tracks.length, c.tracks.map((t) => t.name + ':' + t.times.length).join()]) });
}
function frame(scene) {
  const box = new THREE.Box3().setFromObject(scene);
  const size = box.getSize(new THREE.Vector3()), centre = box.getCenter(new THREE.Vector3());
  return { size, centre, radius: Math.max(size.length() / 2, 1e-3) };
}
function render(scene, view, f) {
  const world = new THREE.Scene();
  world.background = new THREE.Color('#202020');
  world.add(new THREE.HemisphereLight('#ffffff', '#445566', 1.6));
  const sun = new THREE.DirectionalLight('#ffffff', 2.2); sun.position.set(3, 5, 4); world.add(sun);
  world.add(scene);
  const camera = new THREE.PerspectiveCamera(35, 1, f.radius / 50, f.radius * 20);
  const a = view * Math.PI / 2 + 0.6;
  camera.position.set(f.centre.x + Math.sin(a) * f.radius * 3.1, f.centre.y + f.radius * 0.9, f.centre.z + Math.cos(a) * f.radius * 3.1);
  camera.lookAt(f.centre);
  renderer.render(world, camera);
  world.remove(scene);
  const gl = renderer.getContext();
  const pixels = new Uint8Array(384 * 384 * 4);
  gl.readPixels(0, 0, 384, 384, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  return pixels;
}
function compare(a, b) {
  let sq = 0, worst = 0, over = 0, n = 0;
  for (let i = 0; i < a.length; i += 4) for (let c = 0; c < 3; c++) {
    const d = Math.abs(a[i + c] - b[i + c]); sq += d * d; n++; if (d > worst) worst = d; if (c === 0 && Math.max(Math.abs(a[i]-b[i]), Math.abs(a[i+1]-b[i+1]), Math.abs(a[i+2]-b[i+2])) > 24) over++;
  }
  const mse = sq / n;
  return { psnr: mse === 0 ? 99 : 10 * Math.log10(65025 / mse), worst, over: over / (a.length / 4) };
}
function skinnedPositions(gltf, clip, t) {
  const mixer = new THREE.AnimationMixer(gltf.scene);
  if (clip) { const action = mixer.clipAction(clip); action.play(); mixer.setTime(t); }
  gltf.scene.updateMatrixWorld(true);
  const out = [];
  const v = new THREE.Vector3();
  gltf.scene.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    o.skeleton.update();
    const n = o.geometry.attributes.position.count;
    const step = Math.max(1, Math.floor(n / 4000));
    for (let i = 0; i < n; i += step) { o.getVertexPosition(i, v); v.applyMatrix4(o.matrixWorld); out.push(v.x, v.y, v.z); }
  });
  mixer.stopAllAction(); mixer.uncacheRoot(gltf.scene);
  return out;
}
window.qa = async (master, cooked, packedScene) => {
  const [a, b] = await Promise.all([load(master), load(cooked)]);
  const packed = packedScene !== null;
  const sa = packed ? structure(a, 0) : structure(a), sb = packed ? structure(b, packedScene) : structure(b);
  const result = { structure: sa === sb, views: [], pose: { maxMetres: 0, worstClip: null } };
  if (!result.structure) result.detail = [sa, sb];
  if (packed) {
    // Every scene of a packed file draws with the textures of one shared image set.
    const textures = new Set(), images = new Set();
    b.scenes.forEach((scene) => scene.traverse((o) => o.isMesh && [o.material].flat().forEach((m) => Object.values(m).forEach((t) => { if (t?.isTexture) { textures.add(t); images.add(t.source); } }))));
    result.sharedTextures = { textures: textures.size, sources: images.size };
  }
  for (let s = 0; s < a.scenes.length; s++) {
    const f = frame(a.scenes[s]);
    for (let view = 0; view < 4; view++) {
      const pa = render(a.scenes[s], view, f), pb = render(b.scenes[packed ? packedScene : s], view, f);
      result.views.push({ scene: s, view, ...compare(pa, pb) });
    }
  }
  let skinned = false; a.scene.traverse((o) => { if (o.isSkinnedMesh) skinned = true; });
  if (skinned) for (const clip of [null, ...a.animations]) {
    const other = clip ? b.animations.find((c) => c.name === clip.name) : null;
    for (const fraction of clip ? [0, 0.25, 0.5, 0.75, 1] : [0]) {
      const t = clip ? clip.duration * fraction : 0;
      const pa = skinnedPositions(a, clip, t), pb = skinnedPositions(b, other, t);
      if (pa.length !== pb.length) { result.pose.mismatch = true; continue; }
      for (let i = 0; i < pa.length; i += 3) {
        const d = Math.hypot(pa[i] - pb[i], pa[i + 1] - pb[i + 1], pa[i + 2] - pb[i + 2]);
        if (d > result.pose.maxMetres) { result.pose.maxMetres = d; result.pose.worstClip = (clip?.name ?? 'bind') + '@' + fraction; }
      }
    }
  }
  return result;
};
window.shot = async (master, cooked, scene, view, packedScene) => {
  const [a, b] = await Promise.all([load(master), load(cooked)]);
  const f = frame(a.scenes[scene]);
  const toUrl = (pixels) => { const c = document.createElement('canvas'); c.width = c.height = 384; const ctx = c.getContext('2d'); const img = ctx.createImageData(384, 384); for (let y = 0; y < 384; y++) img.data.set(pixels.subarray((383 - y) * 1536, (384 - y) * 1536), y * 1536); ctx.putImageData(img, 0, 0); return c.toDataURL('image/png'); };
  return [toUrl(render(a.scenes[scene], view, f)), toUrl(render(b.scenes[packedScene ?? scene], view, f))];
};
window.ready = true;
</script>`;

const server = http.createServer(async (request, response) => {
  const url = decodeURIComponent(new URL(request.url, 'http://x').pathname);
  try {
    if (url === '/') return response.writeHead(200, { 'Content-Type': 'text/html' }).end(page);
    if (url === '/favicon.ico') return response.writeHead(204).end();
    let file = null;
    if (files.has(url)) file = files.get(url);
    else if (url.startsWith('/vendor/') || url.startsWith('/models/'))
      file = path.join(root, 'public', url);
    if (!file || url.includes('..')) return response.writeHead(404).end();
    const type = url.endsWith('.js') ? 'text/javascript' : 'model/gltf-binary';
    response.writeHead(200, { 'Content-Type': type }).end(await readFile(file));
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--enable-gpu', '--use-angle=d3d11'],
});
const context = await browser.newContext({
  viewport: { width: 384, height: 384 },
  deviceScaleFactor: 1,
});
const tab = await context.newPage();
const errors = [];
tab.on('pageerror', (error) => errors.push(String(error)));
tab.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
await tab.goto(origin);
await tab.waitForFunction(() => window.ready === true);
const results = [];
for (const pair of pairs) {
  const result = await tab.evaluate(
    ([m, c, s]) => window.qa(m, c, s),
    [pair.master, pair.cooked, pair.scene],
  );
  const worst = result.views.reduce((w, v) => (v.psnr < w.psnr ? v : w), { psnr: 99 });
  const row = {
    ...pair,
    file: undefined,
    structure: result.structure,
    minPsnr: Number(worst.psnr.toFixed(2)),
    worstView: worst,
    pose: result.pose,
    sharedTextures: result.sharedTextures,
    detail: result.detail,
  };
  results.push(row);
  console.log(
    `${result.structure ? 'ok ' : 'STRUCTURE'}${pair.scene !== null ? ` [scene ${pair.scene}; ${result.sharedTextures.textures} textures/${result.sharedTextures.sources} images]` : ''} psnr ${row.minPsnr.toFixed(1).padStart(5)} over24 ${(100 * worst.over).toFixed(2).padStart(5)}% pose ${(result.pose.maxMetres * 1000).toFixed(3).padStart(7)}mm ${result.pose.worstClip ?? ''}  ${pair.master}`,
  );
  if (worst.scene !== undefined) {
    const [a, b] = await tab.evaluate(
      ([m, c, s, v, p]) => window.shot(m, c, s, v, p),
      [pair.master, pair.cooked, worst.scene, worst.view, pair.scene],
    );
    const name = pair.master.replace(/^\/models\//, '').replace(/[\\/]/g, '__');
    await writeFile(path.join(out, `${name}.master.png`), Buffer.from(a.split(',')[1], 'base64'));
    await writeFile(path.join(out, `${name}.cooked.png`), Buffer.from(b.split(',')[1], 'base64'));
  }
}
await browser.close();
server.close();
const report = {
  browser: 'chrome (headless, ANGLE D3D11)',
  models: results.length,
  errors,
  results,
};
await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
assert.deepEqual(errors, [], 'browser errors');
const failures = results.filter((row) => !row.structure || row.pose.mismatch);
console.log(
  `${results.length} cooked models compared; ${failures.length} structural failures; report ${path.relative(root, out)}`,
);
if (failures.length) process.exitCode = 1;
