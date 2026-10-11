// Face review sheets for a low-poly head candidate against the adopted character, in real Chrome
// with the game's Three r185 (GLTFLoader + meshopt decoder), the same lights and cameras for both.
//
//   node scripts/face-remake/qa-lowpoly-head.mjs --adopted <glb> --candidate <glb> --out <dir>
//
// Views follow the Head bone: front / three-quarter / side / back and from below the chin at face
// close-up (0.55 m), lit and unlit (the albedo alone, where a bake error cannot hide in shading);
// head-and-shoulders (1.3 m) in the bind pose and mid-walk, mid-run and mid-attack; full body at
// gameplay distance. Writes <out>/sheet-*.jpg (left adopted, right candidate) and report.json with
// per-view PSNR and the neck-seam gap in every sampled pose.
import http from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import sharp from 'sharp';

const { values: args } = parseArgs({
  options: { adopted: { type: 'string' }, candidate: { type: 'string' }, out: { type: 'string' } },
});
const root = path.resolve(import.meta.dirname, '../..');
const out = path.resolve(args.out);
await mkdir(out, { recursive: true });
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const W = 512,
  H = 512;
const page = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#000">
<canvas id="c" width="${W}" height="${H}"></canvas>
<script type="importmap">{"imports":{"three":"/vendor/three.module.js","three/addons/":"/vendor/addons/"}}</script>
<script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('c'), antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const models = {};
window.load = async (name, url) => { models[name] = await loader.loadAsync(url); return true; };
function pose(gltf, clipName, fraction) {
  const mixer = new THREE.AnimationMixer(gltf.scene);
  const clip = clipName ? gltf.animations.find((c) => c.name === clipName) : null;
  if (clip) { mixer.clipAction(clip).play(); mixer.setTime(clip.duration * fraction); }
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => o.isSkinnedMesh && o.skeleton.update());
  return mixer;
}
function headFrame(gltf) {
  const head = gltf.scene.getObjectByName('Head');
  const p = new THREE.Vector3(), q = new THREE.Quaternion();
  head.getWorldPosition(p);
  gltf.scene.getWorldQuaternion(q);
  return { p: p.add(new THREE.Vector3(0, 0.09, 0)), q };
}
function shoot(name, clipName, fraction, view, distance, mode) {
  const gltf = models[name];
  const mixer = pose(gltf, clipName, fraction);
  // Unlit: every material's colour texture alone.
  const swapped = [];
  if (mode === 'albedo')
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      swapped.push([o, o.material]);
      const m = o.material;
      o.material = new THREE.MeshBasicMaterial({ map: m.map, color: m.color, side: m.side, alphaTest: m.alphaTest, transparent: m.transparent });
    });
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#5b6770');
  scene.add(new THREE.HemisphereLight('#dfe9f2', '#5a4b3c', 1.4));
  const sun = new THREE.DirectionalLight('#fff2dd', 2.4); sun.position.set(2, 4, 3); scene.add(sun);
  scene.add(gltf.scene);
  const { p } = view === 'body' ? { p: new THREE.Vector3(0, 0.9, 0) } : headFrame(gltf);
  const angle = { front: 0, three: Math.PI / 4, side: Math.PI / 2, back: Math.PI, chin: 0, body: 0.5 }[view];
  const lift = view === 'body' ? 0.4 : view === 'chin' ? -0.22 : 0.02;
  const camera = new THREE.PerspectiveCamera(view === 'body' ? 40 : 30, ${W} / ${H}, 0.02, 50);
  camera.position.set(p.x + Math.sin(angle) * distance, p.y + lift, p.z + Math.cos(angle) * distance);
  camera.lookAt(p);
  renderer.render(scene, camera);
  for (const [o, m] of swapped) {
    o.material.dispose();
    o.material = m;
  }
  scene.remove(gltf.scene);
  mixer.stopAllAction(); mixer.uncacheRoot(gltf.scene);
  return renderer.domElement.toDataURL('image/png');
}
window.shoot = shoot;
window.seamGap = (name, clipName, fraction) => {
  // Largest distance between a head vertex and the body vertex it was sewn to (same rest position).
  const gltf = models[name];
  const mixer = pose(gltf, clipName, fraction);
  const meshes = []; gltf.scene.traverse((o) => o.isSkinnedMesh && meshes.push(o));
  const key = (v) => [v.x, v.y, v.z].map((c) => Math.round(c * 1e6)).join(',');
  const rest = new THREE.Vector3(), posed = new THREE.Vector3();
  const body = new Map();
  const isHead = (m) => [m.material].flat().some((x) => /face remake head|Lowpoly/i.test(x.name));
  const head = meshes.find(isHead);
  for (const m of meshes) if (m !== head) { const a = m.geometry.attributes.position, n = m.geometry.attributes.normal; for (let i = 0; i < a.count; i++) { rest.fromBufferAttribute(a, i); m.getVertexPosition(i, posed); body.set(key(rest), { position: posed.clone(), normal: new THREE.Vector3().fromBufferAttribute(n, i) }); } }
  let worst = 0, sewn = 0, normalDegrees = 0;
  const a = head.geometry.attributes.position, hn = head.geometry.attributes.normal;
  const n1 = new THREE.Vector3(), n2 = new THREE.Vector3();
  for (let i = 0; i < a.count; i++) {
    rest.fromBufferAttribute(a, i);
    const b = body.get(key(rest));
    if (!b) continue;
    head.getVertexPosition(i, posed);
    sewn++;
    worst = Math.max(worst, posed.distanceTo(b.position));
    // Shading across the seam: the head's rest normal against the body's at the same vertex.
    n1.fromBufferAttribute(hn, i).normalize();
    n2.copy(b.normal).normalize();
    normalDegrees = Math.max(normalDegrees, THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(n1.dot(n2), -1, 1))));
  }
  mixer.stopAllAction(); mixer.uncacheRoot(gltf.scene);
  return { sewn, worst, normalDegrees: Number(normalDegrees.toFixed(3)) };
};
window.ready = true;
</script>`;
const files = {
  '/adopted.glb': path.resolve(args.adopted),
  '/candidate.glb': path.resolve(args.candidate),
};
const server = http.createServer(async (request, response) => {
  const url = decodeURIComponent(new URL(request.url, 'http://x').pathname);
  try {
    if (url === '/') return response.writeHead(200, { 'Content-Type': 'text/html' }).end(page);
    const file =
      files[url] ??
      (url.startsWith('/vendor/') && !url.includes('..') ? path.join(root, 'public', url) : null);
    if (!file) return response.writeHead(404).end();
    response
      .writeHead(200, {
        'Content-Type': url.endsWith('.js') ? 'text/javascript' : 'model/gltf-binary',
      })
      .end(await readFile(file));
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--enable-gpu', '--use-angle=d3d11'],
});
const tab = await (await browser.newContext({ viewport: { width: W, height: H } })).newPage();
const errors = [];
tab.on('pageerror', (e) => errors.push(String(e)));
await tab.goto(`http://127.0.0.1:${server.address().port}/`);
await tab.waitForFunction(() => window.ready === true);
await tab.evaluate(() =>
  Promise.all([window.load('adopted', '/adopted.glb'), window.load('candidate', '/candidate.glb')]),
);
const poses = [
  ['bind', null, 0],
  ['walk', 'Walk_Loop', 0.5],
  ['run', 'Run_Loop', 0.5],
  ['attack', 'Attack', 0.5],
];
const report = { adopted: args.adopted, candidate: args.candidate, views: [], seam: [], errors };
const decode = async (dataUrl) => Buffer.from(dataUrl.split(',')[1], 'base64');
async function sheet(name, rows) {
  const tiles = [];
  for (const [label, clip, fraction, view, distance, mode = 'lit'] of rows) {
    const [a, b] = await tab.evaluate(
      ([c, f, v, d, m]) => [
        window.shoot('adopted', c, f, v, d, m),
        window.shoot('candidate', c, f, v, d, m),
      ],
      [clip, fraction, view, distance, mode],
    );
    const [ra, rb] = await Promise.all(
      [decode(a), decode(b)].map(async (p) =>
        sharp(await p)
          .removeAlpha()
          .raw()
          .toBuffer(),
      ),
    );
    let sq = 0;
    for (let i = 0; i < ra.length; i++) sq += (ra[i] - rb[i]) ** 2;
    const psnr = 10 * Math.log10((255 * 255) / (sq / ra.length || 1e-9));
    report.views.push({
      sheet: name,
      label,
      clip,
      fraction,
      view,
      distance,
      mode,
      psnr: Number(psnr.toFixed(2)),
    });
    tiles.push(await decode(a), await decode(b));
  }
  const composite = tiles.map((input, i) => ({
    input,
    left: (i % 2) * W,
    top: Math.floor(i / 2) * H,
  }));
  await sharp({
    create: { width: 2 * W, height: H * rows.length, channels: 3, background: '#000' },
  })
    .composite(composite)
    .jpeg({ quality: 90 })
    .toFile(path.join(out, `sheet-${name}.jpg`));
}
await sheet('face-bind', [
  ['front', null, 0, 'front', 0.55],
  ['three-quarter', null, 0, 'three', 0.55],
  ['side', null, 0, 'side', 0.55],
  ['back', null, 0, 'back', 0.7],
  ['below-chin', null, 0, 'chin', 0.5],
]);
await sheet('face-albedo', [
  ['front', null, 0, 'front', 0.55, 'albedo'],
  ['three-quarter', null, 0, 'three', 0.55, 'albedo'],
  ['side', null, 0, 'side', 0.55, 'albedo'],
  ['below-chin', null, 0, 'chin', 0.5, 'albedo'],
]);
await sheet('head-poses', [
  ['bind', null, 0, 'three', 1.3],
  ['walk', 'Walk_Loop', 0.5, 'three', 1.3],
  ['run', 'Run_Loop', 0.5, 'front', 1.3],
  ['attack', 'Attack', 0.5, 'three', 1.3],
]);
await sheet('body', [
  ['idle', 'Idle_Loop', 0.3, 'body', 3.2],
  ['walk', 'Walk_Loop', 0.25, 'body', 3.2],
]);
for (const [label, clip, fraction] of [
  ...poses,
  ['idle', 'Idle_Loop', 0.5],
  ['downed', 'Downed', 1],
])
  for (const name of ['adopted', 'candidate'])
    report.seam.push({
      name,
      label,
      ...(await tab.evaluate(([n, c, f]) => window.seamGap(n, c, f), [name, clip, fraction])),
    });
await browser.close();
server.close();
await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
console.log(
  JSON.stringify(
    {
      views: report.views.map((v) => `${v.sheet}/${v.label}:${v.psnr}`),
      seam: report.seam,
      errors,
    },
    null,
    1,
  ),
);
