// Every playable character in its own colours and in each clothing dye, drawn in headless Chrome
// by the shipped shader (dist/src/clothing-dye.js) on the delivered GLBs, for review when a dye
// rule or a character's GLB changes. Usage: node scripts/qa-clothing-dye-palette.mjs [outputDir]
// Reads dist/ (npm run build) and public/ only; writes the sheet and the GLBs' SHA-256.
import http from 'node:http';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLOTHING_DYES } from '../dist/shared/clothing-dye.mjs';
import { CLOTHING_DYE_RULES } from '../dist/src/clothing-dye.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = process.argv[2] || `output/clothing-dye/palette-${Date.now()}`;
await mkdir(output, { recursive: true });
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);

const PAGE = `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#6f8360}</style>
<script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js","three/addons/":"/node_modules/three/examples/jsm/"}}</script>
<script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { installClothingDye } from '/dist/src/clothing-dye.js';
const { keys, dyes, width } = JSON.parse(decodeURIComponent(location.hash.slice(1)));
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.setSize(width, (width * keys.length) / dyes.length);
document.body.append(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color('#6f8360');
scene.add(new THREE.HemisphereLight('#dfe9ff', '#5a4a33', 1.6));
const sun = new THREE.DirectionalLight('#fff3dd', 2.4);
sun.position.set(3, 6, 8);
scene.add(sun);
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
for (const [row, key] of keys.entries()) {
  const asset = await (await fetch('/public/models/' + key + '/asset.json')).json();
  const gltf = await loader.loadAsync('/public' + asset.url);
  for (const [column, dye] of dyes.entries()) {
    const actor = clone(gltf.scene);
    installClothingDye(actor, key, dye || null);
    actor.traverse((node) => { if (node.isMesh) node.frustumCulled = false; });
    const size = new THREE.Box3().setFromObject(actor).getSize(new THREE.Vector3());
    actor.scale.setScalar(0.9 / size.y);
    const centre = new THREE.Box3().setFromObject(actor).getCenter(new THREE.Vector3());
    actor.position.set(column - (dyes.length - 1) / 2 - centre.x, (keys.length - 1) / 2 - row - centre.y, -centre.z);
    scene.add(actor);
  }
}
const camera = new THREE.OrthographicCamera(-dyes.length / 2, dyes.length / 2, keys.length / 2, -keys.length / 2, 0.1, 50);
camera.position.set(0, 0, 10);
renderer.render(scene, camera);
const programs = renderer.info.programs.filter((p) => p.cacheKey.includes('clothing-dye-1')).length;
document.body.dataset.ready = String(programs);
</script>`;

const types = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json' };
const server = http.createServer(async (request, response) => {
  const url = decodeURIComponent(new URL(request.url, 'http://qa').pathname);
  // The browser asks for an icon nobody draws.
  if (url === '/favicon.ico') {
    response.writeHead(204);
    response.end();
    return;
  }
  if (url === '/') {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(PAGE);
    return;
  }
  const allowed = ['/node_modules/three/', '/dist/', '/public/models/'].some((prefix) =>
    url.startsWith(prefix),
  );
  const file = path.join(root, url);
  if (!allowed || !file.startsWith(root)) {
    response.writeHead(404);
    response.end();
    return;
  }
  try {
    const body = await readFile(file);
    response.writeHead(200, {
      'content-type': types[path.extname(file)] ?? 'application/octet-stream',
    });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];
const keys = Object.keys(CLOTHING_DYE_RULES);
const dyes = ['', ...CLOTHING_DYES.map((dye) => dye.key)];
const models = {};
try {
  for (const key of keys) {
    const asset = JSON.parse(await readFile(path.join(root, `public/models/${key}/asset.json`)));
    const bytes = await readFile(path.join(root, `public${asset.url}`));
    models[key] = { url: asset.url, sha256: createHash('sha256').update(bytes).digest('hex') };
  }
  const page = await browser.newPage({ viewport: { width: 1800, height: 1400 } });
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
  page.on('response', (answer) => answer.status() >= 400 && errors.push(answer.url()));
  const { port } = server.address();
  const sheets = [];
  // Three characters per sheet keeps each figure large enough to judge.
  for (let start = 0; start < keys.length; start += 3) {
    const group = keys.slice(start, start + 3);
    const hash = encodeURIComponent(JSON.stringify({ keys: group, dyes, width: 1800 }));
    await page.goto(`http://127.0.0.1:${port}/#${hash}`);
    await page.waitForSelector('body[data-ready]', { timeout: 180000 });
    const programs = Number(await page.locator('body').getAttribute('data-ready'));
    if (programs < 1) throw new Error('the dye program was not linked');
    const file = `${output}/palette-${start / 3 + 1}.png`;
    await page.locator('canvas').screenshot({ path: file });
    sheets.push({ file, characters: group, programs });
    await page.goto('about:blank');
  }
  if (errors.length) throw new Error(errors.join('\n'));
  const record = { columns: dyes.map((dye) => dye || 'own'), sheets, models, errors };
  await writeFile(`${output}/palette.json`, JSON.stringify(record, null, 2));
  console.log(`PASS ${keys.length} characters × ${dyes.length} colours → ${output}`);
} finally {
  await browser.close();
  server.close();
}
