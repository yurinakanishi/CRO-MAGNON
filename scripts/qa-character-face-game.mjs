// Real Chrome walk/double-tap-run with five connections in an unsaved room.
// Profile, positions, enemy removal and idle keepalives are fixtures; movement is real keys.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { WebSocket } from 'ws';
import { createGameServer } from '../dist/server.mjs';
import { stopActor } from '../dist/shared/combat.mjs';
import { enterPreparedWorld } from './qa-game-entry.mjs';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const out = process.argv[2] || `output/playwright/face-rigidity-20261015/game-${Date.now()}`;
await mkdir(out, { recursive: true });
const roomName = 'FACE-QA';
const game = createGameServer({
  host: '127.0.0.1',
  port: 0,
});
const { port } = await game.listen();
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: [
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
  ],
});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const keys = [
  'cro-magnon-woman',
  'cro-magnon-girl-bear',
  'cro-magnon-girl-wolf',
  'cro-magnon-boy-lion',
  'cro-magnon-boy-topknot',
];
const assets = await Promise.all(
  keys.map(async (key) => JSON.parse(await readFile(`public/models/${key}/asset.json`))),
);
const pages = [],
  peers = [],
  errors = [],
  records = [];
let heartbeat;
const observer = `
const qaRender=WorldRenderer.prototype.render;
const qaSamples=new WeakMap();
WorldRenderer.prototype.render=function(...args){
 const result=qaRender.apply(this,args);window.qaRenderer=this;window.qaFrames??=[];
 const players=[...this.players.values()].filter(e=>e.actor).map(e=>{
  const actor=e.actor,head=actor.root.getObjectByName('Head');
  let sample=qaSamples.get(actor);const inverse=new THREE.Matrix4().copy(head.matrixWorld).invert(),point=new THREE.Vector3();
  if(!sample){sample={vertices:[],max:0};actor.root.traverse(m=>{
   if(!m.isSkinnedMesh||m.material.name!=='HeadSurface')return;
   const count=m.geometry.attributes.position.count;
   for(let i=0;i<count;i+=Math.max(1,Math.floor(count/40))){m.getVertexPosition(i,point).applyMatrix4(m.matrixWorld).applyMatrix4(inverse);sample.vertices.push({mesh:m,index:i,rest:point.clone()});}
  });qaSamples.set(actor,sample);}
  for(const v of sample.vertices){v.mesh.getVertexPosition(v.index,point).applyMatrix4(v.mesh.matrixWorld).applyMatrix4(inverse);sample.max=Math.max(sample.max,point.distanceTo(v.rest));}
  return {name:e.state.name,key:actor.asset.modelKey,sha256:actor.asset.sha256,clip:actor.animation.name,vertices:sample.vertices.length,maxDeviationM:sample.max};
 });window.qaFrames.push({t:performance.now(),players});if(window.qaFrames.length>600)window.qaFrames.shift();return result;
};`;
async function open(index) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  pages.push(page);
  // Online entry currently resolves to solo. Exercise the network renderer via
  // an isolated LAN config; no exhibition build or normal server is involved.
  await page.route('**/multiplayer-config.json', (route) =>
    route.fulfill({
      json: {
        mode: 'lan',
        serverUrl: `ws://127.0.0.1:${port}/ws`,
        room: roomName,
        guestName: `Face ${index}`,
      },
    }),
  );
  page.on('pageerror', (error) => errors.push(`${index}: ${error}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`${index}: ${message.text()}`);
  });
  await page.route('**/src/world3d.js', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()) + observer });
  });
  await page.addInitScript(
    ({ key, name }) => {
      for (const [k, v] of Object.entries({
        'cro-name': name,
        'cro-species': 'cro',
        'cro-gender': 'female',
        'cro-character': key,
        'cro-language': 'ja',
      }))
        localStorage.setItem(k, v);
      // Keep the isolated background observer connected while the other visitor moves.
      const Original = window.WebSocket;
      window.WebSocket = class extends Original {
        constructor(...args) {
          super(...args);
          const timer = setInterval(() => {
            if (this.readyState === 1) this.send(JSON.stringify({ type: 'activity' }));
          }, 5000);
          this.addEventListener('close', () => clearInterval(timer));
        }
      };
    },
    { key: keys[index], name: `Face ${index}` },
  );
  await page.goto(`http://127.0.0.1:${port}/?room=${roomName}&autostart=1`);
  await enterPreparedWorld(page, false);
  console.log(`${keys[index]} entered`);
  return page;
}
try {
  await open(0);
  await open(1);
  for (let i = 2; i < 5; i++) {
    const socket = new WebSocket(
      `ws://127.0.0.1:${port}/ws?` +
        new URLSearchParams({
          room: roomName,
          name: `Face ${i}`,
          species: 'cro',
          gender: i < 3 ? 'female' : 'male',
          character: keys[i],
        }),
    );
    peers.push(socket);
    await new Promise((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
  }
  heartbeat = setInterval(() => {
    for (const socket of peers)
      if (socket.readyState === 1) socket.send(JSON.stringify({ type: 'activity' }));
  }, 5000);
  const room = game.rooms.get(roomName);
  await pages[0].waitForFunction(() => window.qaRenderer?.players.size === 5, null, {
    timeout: 60000,
  });
  room.enemies = [];
  room.poisonShots = [];
  room.poisonSplashes = [];
  for (const [i, p] of [...room.players.values()].entries()) {
    stopActor(p);
    Object.assign(p, { x: 74 + i * 2.5, z: 68 });
  }
  for (const page of pages)
    await page.waitForFunction(
      (expected) =>
        expected.every((a) =>
          window.qaFrames
            ?.at(-1)
            ?.players.some((p) => p.key === a.modelKey && p.sha256 === a.sha256 && p.vertices > 20),
        ),
      assets,
      { timeout: 90000 },
    );
  console.log('Five exact models rendered in both Chrome clients.');
  for (let index = 0; index < 2; index++) {
    const page = pages[index],
      other = pages[1 - index];
    await page.bringToFront();
    await page.locator('#world').focus();
    for (const [label, running] of [
      ['walk', false],
      ['double-tap-run', true],
    ]) {
      await sleep(400);
      await page.evaluate(() => (window.qaFrames = []));
      await other.evaluate(() => (window.qaFrames = []));
      if (running) {
        await page.keyboard.press('w');
        await sleep(90);
      }
      await page.keyboard.down('w');
      await sleep(1500);
      await page.screenshot({ path: `${out}/${keys[index]}-${label}.png` });
      await page.keyboard.up('w');
      const clip = running ? 'Run_Loop' : 'Walk_Loop';
      const local = await page.evaluate(() => window.qaFrames),
        remote = await other.evaluate(() => window.qaFrames);
      for (const [view, frames] of [
        ['local', local],
        ['remote', remote],
      ])
        assert.ok(
          frames.some((f) => f.players.some((p) => p.name === `Face ${index}` && p.clip === clip)),
          `${keys[index]} ${label} ${view}`,
        );
      records.push({
        key: keys[index],
        label,
        clip,
        localFrames: local.length,
        remoteFrames: remote.length,
      });
    }
  }
  const rendered = await Promise.all(
    pages.map((page) => page.evaluate(() => window.qaFrames.at(-1).players)),
  );
  for (const rows of rendered)
    for (const row of rows) {
      assert.ok(row.vertices > 20);
      assert.ok(row.maxDeviationM < 0.00002, `${row.key}: ${row.maxDeviationM}`);
    }
  assert.equal(room.players.size, 5);
  assert.deepEqual(errors, []);
  const report = {
    status: 'passed',
    connections: 5,
    chromeClients: 2,
    websocketPeers: 3,
    records,
    rendered,
    errors,
    fixtures:
      'Isolated in-memory room with a LAN client config; seeded profiles, positions, no enemies and idle keepalives. Walk and double-tap run use real keyboard events in Chrome. No user save loaded or written; no exhibition build created.',
  };
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: 'passed', out, records: records.length, errors }));
} catch (error) {
  await writeFile(
    `${out}/failure.json`,
    JSON.stringify({ error: String(error), errors, records }, null, 2) + '\n',
  );
  for (const [i, page] of pages.entries())
    await page.screenshot({ path: `${out}/failure-${i}.png` }).catch(() => {});
  throw error;
} finally {
  clearInterval(heartbeat);
  for (const peer of peers) peer.close();
  await browser.close();
  await game.close();
}
