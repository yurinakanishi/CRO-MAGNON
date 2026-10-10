// Real-browser look at the valley-pine conifer in the game (2026-10-07 natural-tree remake).
// Reuses the behemoth QA host fixture (room BEHEMOTH-QA, `place` command); nothing here
// touches the normal server. Without --candidate it shows the delivered tree; with
// --candidate <model.glb> <lod.glb> the exact candidate GLBs are routed in for review.
// Usage: node scripts/qa-pine-remake.mjs <outDir> [--candidate <model.glb> <lod.glb>]
import { fork } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
const { chromium } =
  await import('file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const out = path.resolve(process.argv[2] || 'output/playwright/pine-remake');
await mkdir(out, { recursive: true });
const candidateAt = process.argv.indexOf('--candidate');
const candidate =
  candidateAt > 0
    ? { model: process.argv[candidateAt + 1], lod: process.argv[candidateAt + 2] }
    : null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  errors = [],
  facts = { candidate, shots: [] };
let child,
  base,
  ready = false,
  rid = 0;
const pending = new Map();
const peers = [];
const request = (kind, extra = {}) =>
  new Promise((resolve, reject) => {
    const id = ++rid;
    pending.set(id, { resolve, reject });
    child.send({ id, kind, ...extra });
  });
async function until(fn, label, limit = 30000) {
  const start = Date.now();
  while (!(await fn())) {
    if (Date.now() - start > limit) throw Error('Timeout ' + label);
    await sleep(100);
  }
}
async function view(page, yaw, pitch, distance) {
  await page.evaluate(
    ({ yaw, pitch, distance }) => {
      const r = window.monsterReview;
      r.yaw = yaw;
      r.pitch = pitch;
      r.distance = distance;
      r.targetDistance = distance;
    },
    { yaw, pitch, distance },
  );
  await sleep(1200);
}
async function shot(page, name) {
  await page.screenshot({ path: path.join(out, name + '.png') });
  facts.shots.push(name);
}
const glbInfo = (bytes) => {
  const doc = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
  let triangles = 0;
  for (const m of doc.meshes)
    for (const p of m.primitives) triangles += doc.accessors[p.indices].count / 3;
  return {
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.length,
    triangles,
  };
};
let context;
try {
  child = fork(new URL('./qa-violet-behemoth-host.mjs', import.meta.url), [], {
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    windowsHide: true,
  });
  let log = '';
  child.stdout.on('data', (b) => (log += b));
  child.stderr.on('data', (b) => (log += b));
  child.on('message', (m) => {
    if (m.ready) {
      base = `http://127.0.0.1:${m.port}`;
      ready = true;
    }
    if (m.reply) {
      const p = pending.get(m.reply);
      pending.delete(m.reply);
      m.ok ? p?.resolve(m.value) : p?.reject(Error(m.error));
    }
  });
  await until(() => {
    if (child.exitCode !== null) throw Error(log);
    return ready;
  }, 'host');
  context = await chromium.launchPersistentContext(path.join(out, 'profile'), {
    channel: 'chrome',
    headless: true,
    viewport: { width: 1440, height: 900 },
    args: ['--use-angle=d3d11', '--disable-background-timer-throttling'],
  });
  const page = context.pages()[0] || (await context.newPage());
  if (candidate) {
    const manifest = JSON.parse(await readFile('public/models/valley-pine/asset.json', 'utf8'));
    const model = glbInfo(await readFile(candidate.model)),
      lod = glbInfo(await readFile(candidate.lod));
    Object.assign(manifest, { ...model, lods: [{ url: manifest.lods[0].url, ...lod }] });
    await page.route(`**${manifest.url}`, (route) =>
      route.fulfill({ path: candidate.model, contentType: 'model/gltf-binary' }),
    );
    await page.route(`**${manifest.lods[0].url}`, (route) =>
      route.fulfill({ path: candidate.lod, contentType: 'model/gltf-binary' }),
    );
    await page.route('**/models/valley-pine/asset.json', (route) =>
      route.fulfill({ json: manifest }),
    );
    const catalog = JSON.parse(await readFile('public/models/world-assets.json', 'utf8'));
    catalog.assets = catalog.assets.map((asset) =>
      asset.modelKey === 'valley-pine' ? manifest : asset,
    );
    await page.route('**/models/world-assets.json', (route) => route.fulfill({ json: catalog }));
    facts.routed = { model, lod };
  }
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.addInitScript(() => {
    localStorage.setItem('cro-name', 'Monster A');
    localStorage.setItem('cro-species', 'cro');
    localStorage.setItem('cro-gender', 'female');
  });
  await page.goto(base + '/?room=BEHEMOTH-QA');
  await page.locator('#title-start').click();
  await page.locator('#setup-form input[name="name"]').fill('Monster A');
  await page.locator('#setup-form .character-choice:has(input:checked)').click();
  await page.locator('#setup-flow-yes').click();
  await page.waitForSelector('body.in-game', { timeout: 60000 });
  await page
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 120000 });
  await until(() => page.evaluate(() => !!window.monsterReview?.selfId), 'renderer');
  for (let i = 0; i < 4; i++) {
    const peer = new WebSocket(
      base.replace('http:', 'ws:') +
        '/ws?' +
        new URLSearchParams({
          room: 'BEHEMOTH-QA',
          name: `Pine peer ${i}`,
          species: 'cro',
          gender: 'female',
        }),
    );
    peers.push(peer);
    await new Promise((resolve, reject) => {
      peer.once('open', resolve);
      peer.once('error', reject);
    });
  }
  await until(
    () =>
      page
        .locator('#online-count')
        .innerText()
        .then((value) => value === '5/5'),
    'five players connected',
  );
  facts.players = 5;
  // The delivered pine template actually used by the landscape instances.
  facts.template = await page.evaluate(() => {
    const t = window.monsterReview.worldAssets.get('valley-pine');
    const count = (scene) => {
      let n = 0;
      scene.traverse((node) => node.isMesh && (n += node.geometry.index.count / 3));
      return n;
    };
    return {
      model: count(t.gltf.scene),
      lod: t.lods.map((l) => count(l.scene)),
      sha256: t.asset.sha256,
    };
  });
  if (candidate) assert.equal(facts.template.sha256, facts.routed.model.sha256);
  // Densest cluster near the start (11 pines within 12 m of (8, 0)), then the trees by the camp.
  await request('place', { x: 8, z: 0 });
  await sleep(3500);
  await view(page, 0.6, 0.12, 6);
  await shot(page, '01-cluster-eye-level');
  await view(page, 2.4, 0.1, 5);
  await shot(page, '02-cluster-other-side');
  await view(page, 0.6, 0.42, 22);
  await shot(page, '03-cluster-overview');
  await view(page, 1.4, -0.35, 4);
  await shot(page, '04-looking-up');
  await request('place', { x: 40, z: 40 });
  await sleep(3500);
  await view(page, -2.2, 0.16, 8);
  await shot(page, '05-camp-trees');
  await view(page, -2.2, 0.3, 40);
  await shot(page, '06-camp-far-lod');
  facts.errors = errors;
  assert.deepEqual(errors, []);
  facts.status = 'passed';
} catch (error) {
  facts.status = 'failed';
  facts.error = String(error?.stack ?? error);
  facts.errors = errors;
  process.exitCode = 1;
} finally {
  await writeFile(path.join(out, 'facts.json'), JSON.stringify(facts, null, 2) + '\n');
  for (const peer of peers) peer.close();
  await context?.close();
  child?.kill();
}
console.log(
  JSON.stringify({ status: facts.status, error: facts.error, template: facts.template }, null, 1),
);
