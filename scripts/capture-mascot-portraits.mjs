// Photograph the exact delivered companions through the game's verified loader.
// Usage: node scripts/capture-mascot-portraits.mjs assets/mascot-portraits/<new-revision>
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { createGameServer } from '../dist/server.mjs';
import { readDeliveryOverlay } from '../dist/infrastructure/node/delivery-overlay.mjs';
import { MASCOT_PORTRAITS } from '../dist/src/mascot-portraits.js';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
if (!process.argv[2]) throw Error('Choose a new portrait revision directory.');
const output = resolve(process.argv[2]);
await mkdir(output, { recursive: true });
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const width = 384,
  height = 320,
  span = 0.78;
const game = createGameServer({
  host: '127.0.0.1',
  port: 0,
  delivery: await readDeliveryOverlay(process.cwd()),
});
const { port } = await game.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [],
  records = [];
const html = `<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,">
<style>body{margin:0;background:#18221c}canvas{display:block}</style>
<script type="importmap">{"imports":{"three":"/vendor/three.module.js","three/addons/":"/vendor/addons/"}}</script>
<script type="module">
import * as THREE from 'three';
import { WorldAssets } from '/src/world-assets.js';
import { COMPANION_524 } from '/shared/companion-524.mjs';
const renderer = new THREE.WebGLRenderer({antialias:true,alpha:true,preserveDrawingBuffer:true});
renderer.setPixelRatio(1); renderer.setSize(${width}, ${height});
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1;
renderer.setClearColor(0x000000,0); document.body.append(renderer.domElement);
const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight('#f1eee8','#594a37',2));
for (const [p,intensity] of [[[2,3,4],2],[[-3,1,2],0.7]]) {
  const light = new THREE.DirectionalLight('#fff3df',intensity); light.position.set(...p); scene.add(light);
}
const camera = new THREE.OrthographicCamera(-${(span * width) / height / 2},${(span * width) / height / 2},${span / 2},-${span / 2},0.01,50);
const assets = new WorldAssets(); let actor;
window.photograph = async (key) => {
  if(actor) scene.remove(actor.root);
  await assets.loadStartup([key]);
  const clip = key === COMPANION_524.modelKey ? 'Floating_Ripple' : 'Idle_Loop';
  actor = assets.createAnimal(key,clip);
  if(key === COMPANION_524.modelKey) actor.root.scale.setScalar(COMPANION_524.scale);
  actor.sampleOnce(clip,0.4);
  actor.root.updateMatrixWorld(true);
  actor.root.traverse(node => { if(node.isSkinnedMesh) node.skeleton.update(); });
  const bounds = new THREE.Box3().setFromObject(actor.root,true);
  const center = bounds.getCenter(new THREE.Vector3());
  camera.position.copy(center).add(new THREE.Vector3(0.75,0.35,2)); camera.lookAt(center); camera.updateMatrixWorld();
  scene.add(actor.root); renderer.render(scene,camera);
  return { png:renderer.domElement.toDataURL('image/png'), asset:actor.asset, clip,time:actor.mixer.time,
    scale:actor.root.scale.toArray(),bounds:{min:bounds.min.toArray(),max:bounds.max.toArray()},
    camera:{position:camera.position.toArray(),target:center.toArray(),verticalSpan:${span}} };
};
window.studioReady = true;
</script>`;
let failure;
try {
  const page = await browser.newPage({ viewport: { width, height } });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.route('**/__mascot-studio', (route) =>
    route.fulfill({ contentType: 'text/html', body: html }),
  );
  await page.goto(`http://127.0.0.1:${port}/__mascot-studio`);
  await page.waitForFunction(() => window.studioReady);
  for (const portrait of MASCOT_PORTRAITS) {
    const shot = await page.evaluate((key) => window.photograph(key), portrait.modelKey);
    const delivered = Buffer.from(
      await (await fetch(`http://127.0.0.1:${port}${shot.asset.url}`)).arrayBuffer(),
    );
    assert.equal(sha256(delivered), shot.asset.sha256);
    const png = Buffer.from(shot.png.split(',')[1], 'base64');
    delete shot.png;
    const webp = await sharp(png).webp({ lossless: true, effort: 6 }).toBuffer();
    const rgba = await sharp(png).ensureAlpha().raw().toBuffer();
    const decoded = await sharp(webp).ensureAlpha().raw().toBuffer();
    const bounds = { left: width, right: -1, top: height, bottom: -1 };
    let visible = 0;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        assert.equal(rgba[i + 3], decoded[i + 3]);
        if (rgba[i + 3]) assert.ok(rgba.subarray(i, i + 3).equals(decoded.subarray(i, i + 3)));
        if (rgba[i + 3] > 8) {
          visible++;
          bounds.left = Math.min(bounds.left, x);
          bounds.right = Math.max(bounds.right, x);
          bounds.top = Math.min(bounds.top, y);
          bounds.bottom = Math.max(bounds.bottom, y);
        }
      }
    assert.ok(visible > 3000, 'Nonempty photograph');
    assert.ok(
      bounds.left >= 6 && bounds.top >= 6 && bounds.right < width - 6 && bounds.bottom < height - 6,
      'Unclipped companion',
    );
    const files = {};
    for (const [extension, bytes] of [
      ['png', png],
      ['webp', webp],
    ]) {
      const file = `${portrait.modelKey}.${extension}`;
      await writeFile(`${output}/${file}`, bytes, { flag: 'wx' });
      files[extension] = { file, bytes: bytes.length, sha256: sha256(bytes) };
    }
    const source = JSON.parse(
      await readFile(`public/models/${portrait.modelKey}/asset.json`, 'utf8'),
    );
    records.push({
      ...portrait,
      ...shot,
      source: { url: source.url, sha256: source.sha256 },
      visiblePixels: visible,
      pixelBounds: bounds,
      files,
    });
    console.log('CAPTURED', portrait.key, visible, 'pixels');
  }
  const figures = [];
  for (const record of records) {
    const bytes = await readFile(`${output}/${record.files.webp.file}`);
    figures.push(
      `<figure><img src="data:image/webp;base64,${bytes.toString('base64')}"><figcaption>${record.key}</figcaption></figure>`,
    );
  }
  await page.setViewportSize({ width: 800, height: 380 });
  await page.setContent(
    `<style>body{margin:0;background:#18221c;color:#eee;display:flex;font:18px sans-serif}figure{margin:8px;text-align:center}img{width:384px;height:320px;object-fit:contain}</style>${figures.join('')}`,
  );
  await page
    .locator('img')
    .evaluateAll((images) => Promise.all(images.map((image) => image.decode())));
  await page.screenshot({ path: `${output}/review.png` });
  assert.deepEqual(errors, []);
} catch (error) {
  failure = error;
  console.error(error);
} finally {
  const inputs = {};
  for (const file of [
    'scripts/capture-mascot-portraits.mjs',
    'src/world-assets.ts',
    'shared/companion-524.mts',
    'shared/rimo-neko.mts',
  ])
    inputs[file] = sha256(await readFile(file));
  await writeFile(
    `${output}/capture.json`,
    JSON.stringify(
      {
        ok: !failure,
        failure: failure?.stack,
        width,
        height,
        span,
        browser: await browser.version(),
        inputs,
        records,
        errors,
      },
      null,
      2,
    ),
  );
  await writeFile(
    `${output}/capture-mascot-portraits.mjs`,
    await readFile('scripts/capture-mascot-portraits.mjs'),
    { flag: 'wx' },
  );
  await browser.close();
  await game.close();
  process.exit(failure ? 1 : 0);
}
