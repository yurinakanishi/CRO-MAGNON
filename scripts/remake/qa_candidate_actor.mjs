// Preview an unadopted playable-character candidate in the real game, without touching public/:
// an isolated in-memory server (dist/server.mjs), real Chrome entering the world as <key>, with only the
// character's manifest and GLB answered by Playwright routes (the game still verifies the served bytes
// against the manifest's SHA-256 and length).
//
//   node scripts/remake/qa_candidate_actor.mjs <key> <choice> <candidate.glb> <candidate-asset.json> <outFolder>
//   e.g. node scripts/remake/qa_candidate_actor.mjs cro-magnon-woman cro-female output/.../model.glb output/.../asset.json output/playwright/c3
// Since 2026-10-15 the title's online start is solo play and the setup is a two-screen flow, so the look is
// preset in localStorage (cro-character = <key>; <choice>, the selection card's value, is only recorded) and
// the room is joined through an isolated LAN multiplayer config with activity keepalives, as
// scripts/qa-character-face-game.mjs does. The picker itself is exercised by scripts/qa-character-choice.mjs.
//
// Screenshots: the game camera after entry, a front inspection camera (renderer yaw/pitch/distance only),
// walking and running with real keys, an attack with the real key, and a close camera. report.json records
// the served SHA, the actor's SHA and clips seen in the renderer, and page errors.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createGameServer } from '../../dist/server.mjs';
import { enterPreparedWorld } from '../qa-game-entry.mjs';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);

const [key, choice, glbPath, assetPath, folder] = process.argv.slice(2);
if (!folder)
  throw new Error(
    'usage: qa_candidate_actor.mjs <key> <choice> <candidate.glb|-> <asset.json|-> <outFolder>',
  );
// '-' '-': the adopted manifest and GLB exactly as public/ serves them (no routes), plus a second real
// client and three protocol peers (five connections) that must see this character's clips remotely.
const adopted = glbPath === '-';
await mkdir(folder, { recursive: true });
const current = JSON.parse(await readFile(`public/models/${key}/asset.json`, 'utf8'));
const bytes = await readFile(adopted ? `public${current.url}` : glbPath);
const sha256 = createHash('sha256').update(bytes).digest('hex');
if (adopted) assert.equal(sha256, current.sha256, 'public GLB matches its manifest');
const candidate = adopted ? current : JSON.parse(await readFile(assetPath, 'utf8'));
const url = adopted ? current.url : `/__candidate/${key}/${sha256.slice(0, 16)}.glb`;
const manifest = {
  ...current,
  ...Object.fromEntries(
    [
      'clips',
      'locomotion',
      'heightMetres',
      'triangles',
      'humanLocomotion',
      'spearThrust',
      'downedMotion',
    ]
      .filter((name) => candidate[name] !== undefined)
      .map((name) => [name, candidate[name]]),
  ),
  url,
  sha256,
  bytes: bytes.length,
  lods: [],
};
const game = createGameServer({ host: '127.0.0.1', port: 0 });
const { port } = await game.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const observer = `
const qaOriginalRender = WorldRenderer.prototype.render;
WorldRenderer.prototype.render = function (...args) {
  const result = qaOriginalRender.apply(this, args);
  window.qaRenderer = this;
  const me = this.players.get(this.selfId);
  if (me?.actor) {
    window.qaClips ??= new Set();
    window.qaClips.add(me.actor.animation.name);
    window.qaActor = { sha: me.actor.asset.sha256, clip: me.actor.animation.name, key: me.actor.asset.modelKey };
  }
  return result;
};`;
const report = {
  key,
  choice,
  mode: adopted ? 'adopted public files, five connections' : 'routed candidate',
  candidate: adopted ? `public${url}` : glbPath,
  sha256,
  bytes: bytes.length,
  url,
  shots: [],
  errors,
};
const peers = [];
let heartbeat;
async function client(lookKey, name, observe) {
  const look = JSON.parse(await readFile(`public/models/${lookKey}/asset.json`, 'utf8'));
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  if (!adopted) {
    await page.route(`**/models/${key}/asset.json`, (route) => route.fulfill({ json: manifest }));
    await page.route(`**${url}`, (route) =>
      route.fulfill({ body: bytes, contentType: 'model/gltf-binary' }),
    );
  }
  await page.route('**/src/world3d.js', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()) + observe });
  });
  await page.route('**/multiplayer-config.json', (route) =>
    route.fulfill({
      json: {
        mode: 'lan',
        serverUrl: `ws://127.0.0.1:${port}/ws`,
        room: 'CANDIDATE-QA',
        guestName: name,
      },
    }),
  );
  await page.addInitScript(
    ({ name, species, gender, character }) => {
      for (const [k, v] of Object.entries({
        'cro-name': name,
        'cro-species': species,
        'cro-gender': gender,
        'cro-character': character,
        'cro-language': 'ja',
      }))
        localStorage.setItem(k, v);
      // Online play leaves after 30 s without input; the screenshots and waits are not input.
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
    { name, species: look.species ?? 'cro', gender: look.gender, character: lookKey },
  );
  await page.goto(`http://127.0.0.1:${port}/?room=CANDIDATE-QA&autostart=1`);
  await enterPreparedWorld(page, false);
  return page;
}
// The second client records every remote actor of this model key with its clip.
const remoteObserver = `
const qaRemoteRender = WorldRenderer.prototype.render;
WorldRenderer.prototype.render = function (...args) {
  const result = qaRemoteRender.apply(this, args);
  window.qaRemote ??= [];
  for (const [id, entity] of this.players) {
    if (id === this.selfId || !entity.actor) continue;
    if (entity.actor.asset.modelKey !== ${JSON.stringify(key)}) continue;
    window.qaRemote.push({ sha: entity.actor.asset.sha256, clip: entity.actor.animation.name });
  }
  if (window.qaRemote.length > 3000) window.qaRemote.splice(0, 1000);
  return result;
};`;
try {
  const page = await client(key, 'Candidate', observer);
  await page
    .locator(`#world[data-player-model="${key}"]`)
    .waitFor({ timeout: 90000 })
    .catch(() => {});
  await page.waitForFunction((sha) => window.qaActor?.sha === sha, sha256, { timeout: 90000 });
  let other = null;
  if (adopted) {
    other = await client(
      key === 'cro-magnon-hunter' ? 'cro-magnon-woman' : 'cro-magnon-hunter',
      'Observer',
      remoteObserver,
    );
    const { WebSocket } = await import('ws');
    for (let i = 0; i < 3; i++) {
      const socket = new WebSocket(
        `ws://127.0.0.1:${port}/ws?` +
          new URLSearchParams({
            room: 'CANDIDATE-QA',
            name: `Peer ${i}`,
            species: 'cro',
            gender: i === 2 ? 'male' : 'female',
            character: ['cro-magnon-woman', 'cro-magnon-girl-bear', 'cro-magnon-boy-lion'][i],
          }),
      );
      await new Promise((resolve, reject) => {
        socket.once('open', resolve);
        socket.once('error', reject);
      });
      peers.push(socket);
    }
    heartbeat = setInterval(() => {
      for (const socket of peers)
        if (socket.readyState === 1) socket.send(JSON.stringify({ type: 'activity' }));
    }, 5000);
    await sleep(1500);
    report.connections = 2 + peers.length;
  }
  const room = game.rooms.get('CANDIDATE-QA');
  if (room) {
    room.enemies = [];
    room.poisonShots = [];
    room.poisonSplashes = [];
  }
  await sleep(1500);
  const shot = async (name) => {
    await page.screenshot({ path: `${folder}/${name}.png` });
    report.shots.push({ name, actor: await page.evaluate(() => window.qaActor) });
  };
  await shot('game-default');
  await page.locator('#world').focus();
  for (const [label, run] of [
    ['walk', false],
    ['run', true],
  ]) {
    if (run) await page.keyboard.down('Shift');
    await page.keyboard.down('w');
    await sleep(1400);
    await shot(`game-${label}`);
    await page.keyboard.up('w');
    if (run) await page.keyboard.up('Shift');
    await sleep(700);
  }
  await page.keyboard.press('f');
  await sleep(300);
  await shot('game-attack');
  await sleep(1200);
  // Inspection cameras only; the model, animation and world state are untouched.
  for (const [name, distance, pitch] of [
    ['game-front', 3.2, 0.12],
    ['game-close', 1.7, 0.05],
  ]) {
    await page.evaluate(
      ({ distance, pitch }) => {
        qaRenderer.yaw = Math.PI;
        qaRenderer.pitch = pitch;
        qaRenderer.targetDistance = distance;
      },
      { distance, pitch },
    );
    await sleep(900);
    await shot(name);
  }
  report.clipsSeen = await page.evaluate(() => [...(window.qaClips ?? [])]);
  if (other) {
    const remote = await other.evaluate(() => window.qaRemote ?? []);
    report.remote = {
      frames: remote.length,
      shaMatches: remote.length > 0 && remote.every((r) => r.sha === sha256),
      clips: [...new Set(remote.map((r) => r.clip))],
    };
    await other.screenshot({ path: `${folder}/remote-view.png` });
    assert.ok(report.remote.shaMatches, 'the other client renders the adopted bytes');
    for (const clip of ['Walk_Loop', 'Run_Loop', 'Attack'])
      assert.ok(report.remote.clips.includes(clip), `remote ${clip}`);
  }
  report.actorShaMatches = report.shots.every((s) => s.actor?.sha === sha256);
  assert.ok(report.actorShaMatches, 'the renderer shows the candidate bytes');
  report.status = errors.length ? 'errors' : 'passed';
} catch (error) {
  report.status = 'failed';
  report.failure = String(error?.stack ?? error);
  throw error;
} finally {
  await writeFile(`${folder}/report.json`, JSON.stringify(report, null, 2) + '\n');
  clearInterval(heartbeat);
  for (const socket of peers) socket.close();
  await browser.close();
  await game.close?.();
  console.log(
    JSON.stringify({
      status: report.status,
      shots: report.shots.length,
      clips: report.clipsSeen,
      errors: errors.length,
    }),
  );
}
