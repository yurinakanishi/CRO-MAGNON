// Photograph the delivered characters with the game's own clothing shader and Idle_Loop.
// No user room/save, model edit or image repaint. A new directory preserves each revision.
// Usage: node scripts/capture-character-portraits.mjs assets/character-portraits/20261015-r01
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { createGameServer } from '../dist/server.mjs';
import { readDeliveryOverlay } from '../dist/infrastructure/node/delivery-overlay.mjs';
import { PLAYABLE_CHARACTER_MODELS } from '../dist/shared/characters.mjs';
import { CLOTHING_DYES } from '../dist/shared/clothing-dye.mjs';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const output = resolve(process.argv[2] || 'assets/character-portraits/20261015-r01');
await mkdir(output, { recursive: true });
const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const game = createGameServer({
  host: '127.0.0.1',
  port: 0,
  delivery: await readDeliveryOverlay(process.cwd()),
});
const { port } = await game.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [],
  records = [];
const width = 336,
  height = 384;
const html = `<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,">
<style>body{margin:0;background:#18221c}canvas{display:block}</style>
<script type="importmap">{"imports":{"three":"/vendor/three.module.js","three/addons/":"/vendor/addons/"}}</script>
<script type="module">
import * as THREE from 'three';
import { CharacterAssets } from '/src/character-assets.js';
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(${width}, ${height});
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
renderer.setClearColor(0x000000, 0);
document.body.append(renderer.domElement);
const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight('#f1eee8', '#594a37', 2));
for (const [position, power] of [[[2,3,4],2], [[-3,1,2],0.7]]) {
  const light = new THREE.DirectionalLight('#fff3df', power);
  light.position.set(...position);
  scene.add(light);
}
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 50);
let provider, actor, original;
window.preparePortrait = async (key) => {
  if (actor) scene.remove(actor.root);
  provider?.dispose();
  provider = new CharacterAssets('/models/' + key + '/asset.json');
  actor = await provider.create({ color: '#b7a27a', dye: null });
  if (!actor?.clothing) throw Error('Missing character or clothing rule: ' + key);
  actor.animation.mixer.setTime(0.4);
  actor.root.updateMatrixWorld(true);
  actor.root.traverse((node) => { if (node.isSkinnedMesh) node.skeleton.update(); });
  const bounds = new THREE.Box3().setFromObject(actor.root, true);
  const size = bounds.getSize(new THREE.Vector3()), center = bounds.getCenter(new THREE.Vector3());
  const span = Math.max(size.y, size.x / (${width} / ${height})) * 1.16;
  camera.top = span / 2; camera.bottom = -span / 2;
  camera.right = span * (${width} / ${height}) / 2; camera.left = -camera.right;
  camera.updateProjectionMatrix();
  camera.position.copy(center).add(new THREE.Vector3(0, 0, 10));
  camera.lookAt(center);
  camera.updateMatrixWorld();
  scene.add(actor.root);
  original = null;
  const asset = actor.asset;
  return { modelKey: asset.modelKey, url: asset.url, sha256: asset.sha256, bytes: asset.bytes,
    scene: asset.scene ?? 0, bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() },
    camera: { center: center.toArray(), verticalSpan: span },
    clip: actor.animation.name, time: actor.animation.mixer.time };
};
window.capturePortrait = (dye) => {
  actor.setDye(dye);
  renderer.render(scene, camera);
  const gl = renderer.getContext(), pixels = new Uint8Array(${width} * ${height} * 4);
  gl.readPixels(0, 0, ${width}, ${height}, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  let visible = 0, changed = 0, alphaChanges = 0;
  const bounds = { left: ${width}, right: -1, top: ${height}, bottom: -1 };
  for (let y = 0; y < ${height}; y++) for (let x = 0; x < ${width}; x++) {
    const i = (y * ${width} + x) * 4;
    if (pixels[i + 3] > 8) {
      visible++;
      bounds.left = Math.min(bounds.left, x); bounds.right = Math.max(bounds.right, x);
      bounds.top = Math.min(bounds.top, ${height} - 1 - y); bounds.bottom = Math.max(bounds.bottom, ${height} - 1 - y);
    }
    if (original) {
      alphaChanges += Number(pixels[i + 3] !== original[i + 3]);
      changed += Number(pixels[i + 3] > 8 && Math.max(...[0,1,2].map((c) => Math.abs(pixels[i+c] - original[i+c]))) >= 12);
    }
  }
  if (!original) original = pixels;
  return { png: renderer.domElement.toDataURL('image/png'),
    visiblePixels: visible, changedPixels: changed, alphaChanges, bounds,
    shader: renderer.info.programs.some((program) => program.cacheKey.includes('clothing-dye-1')),
    dye: actor.clothing.dye, width: ${width}, height: ${height} };
};
window.portraitStudioReady = true;
</script>`;
let failure;
try {
  const page = await browser.newPage({ viewport: { width, height } });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.route('**/__portrait-studio', (route) =>
    route.fulfill({ contentType: 'text/html', body: html }),
  );
  await page.goto(`http://127.0.0.1:${port}/__portrait-studio`);
  await page.waitForFunction(() => window.portraitStudioReady);
  for (const model of PLAYABLE_CHARACTER_MODELS) {
    const source = await page.evaluate((key) => window.preparePortrait(key), model.key);
    assert.equal(source.modelKey, model.key);
    assert.equal(source.clip, 'Idle_Loop');
    const fetched = await fetch(`http://127.0.0.1:${port}${source.url}`);
    assert.equal(fetched.status, 200);
    assert.equal(sha256(Buffer.from(await fetched.arrayBuffer())), source.sha256);
    const photos = [];
    await mkdir(`${output}/${model.key}`, { recursive: true });
    for (const dye of [null, ...CLOTHING_DYES.map((entry) => entry.key)]) {
      const shot = await page.evaluate((value) => window.capturePortrait(value), dye);
      const name = dye ?? 'original';
      assert.equal(shot.dye, dye);
      assert.equal(shot.shader, true);
      assert.equal(shot.alphaChanges, 0, 'Recolouring preserves the exact pose and silhouette');
      assert.ok(shot.visiblePixels > 3000, `${model.key}: empty portrait`);
      assert.ok(
        shot.bounds.left >= 4 &&
          shot.bounds.right < width - 4 &&
          shot.bounds.top >= 4 &&
          shot.bounds.bottom < height - 4,
        `${model.key}: clipped figure`,
      );
      if (dye) assert.ok(shot.changedPixels > 60, `${model.key}/${dye}: no visible colour change`);
      const png = Buffer.from(shot.png.split(',')[1], 'base64');
      const webp = await sharp(png).webp({ lossless: true, effort: 6 }).toBuffer();
      const rgba = await sharp(png).ensureAlpha().raw().toBuffer();
      const decoded = await sharp(webp).ensureAlpha().raw().toBuffer();
      for (let i = 0; i < rgba.length; i += 4) {
        assert.equal(rgba[i + 3], decoded[i + 3], 'Portrait alpha stays exact');
        if (rgba[i + 3])
          assert.ok(
            rgba.subarray(i, i + 3).equals(decoded.subarray(i, i + 3)),
            'Visible photo pixels stay exact',
          );
      }
      for (const type of ['png', 'webp']) {
        const bytes = type === 'png' ? png : webp;
        const file = `${model.key}/${name}.${type}`;
        await writeFile(`${output}/${file}`, bytes, { flag: 'wx' });
        shot[type] = { file, bytes: bytes.length, sha256: sha256(bytes) };
      }
      photos.push(shot);
    }
    records.push({ key: model.key, name: model.name, source, photos });
    console.log('CAPTURED', model.key, photos.length, 'colours');
  }
  // Browser contact sheets: inspect every photographed combination against the card's dark backdrop.
  await page.setViewportSize({ width: 1240, height: 650 });
  for (let start = 0; start < records.length; start += 3) {
    const rows = [];
    for (const model of records.slice(start, start + 3)) {
      const cells = [];
      for (const photo of model.photos) {
        const bytes = await readFile(`${output}/${photo.webp.file}`);
        cells.push(
          `<figure><img src="data:image/webp;base64,${bytes.toString('base64')}"><figcaption>${photo.dye ?? 'original'}</figcaption></figure>`,
        );
      }
      rows.push(`<section><h2>${model.name}</h2><div>${cells.join('')}</div></section>`);
    }
    await page.setContent(
      `<style>body{margin:12px;background:#18221c;color:#eee;font:12px sans-serif}h2{margin:6px 0;font-size:13px}section>div{display:grid;grid-template-columns:repeat(9,1fr);gap:6px}figure{margin:0;text-align:center}img{display:block;width:126px;height:144px;object-fit:contain}figcaption{line-height:18px}</style>${rows.join('')}`,
    );
    await page
      .locator('img')
      .evaluateAll((images) => Promise.all(images.map((image) => image.decode())));
    await page.screenshot({ path: `${output}/review-${start / 3 + 1}.png` });
  }
  assert.deepEqual(errors, []);
} catch (error) {
  failure = error;
  console.error(error);
} finally {
  const inputs = {};
  for (const file of [
    'src/character-assets.ts',
    'src/character-animation.ts',
    'src/clothing-dye.ts',
    'src/clothing-dye-rules.ts',
    'shared/clothing-dye.mts',
    'scripts/capture-character-portraits.mjs',
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
        generator: 'scripts/capture-character-portraits.mjs',
        browser: await browser.version(),
        renderer: { toneMapping: 'ACESFilmic', exposure: 1.1, hemisphere: 2, key: 2, fill: 0.7 },
        inputs,
        records,
        errors,
      },
      null,
      2,
    ),
  );
  await browser.close();
  await game.close();
  process.exit(failure ? 1 : 0);
}
