import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { WebSocket } from 'ws';
import { createGameServer } from '../server.mjs';
import { createExhibitionClient } from '../dist/infrastructure/node/exhibition-client.mjs';
import {
  parseMultiplayerConfig,
  multiplayerUrl,
  multiplayerSessionKey,
} from '../dist/src/multiplayer-config.js';
import { LocalPrediction } from '../dist/src/local-prediction.js';
import { parseSettings, readSettings } from '../scripts/exhibition-config.mjs';
import { sha256, buildId, verifyExhibition } from '../scripts/exhibition-integrity.mjs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
const root = path.resolve(import.meta.dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function peer(url, origin, name = 'Player', build = 'test-build', session = '') {
  const socket = new WebSocket(
    multiplayerUrl({ mode: 'lan', serverUrl: url, buildId: build }, origin, {
      name,
      room: 'LAN-TEST',
      species: 'cro',
      gender: 'female',
      resume: '1',
      session,
    }),
    { origin },
  );
  const messages = [];
  socket.on('message', (data) => messages.push(JSON.parse(data.toString())));
  socket.on('error', () => {});
  return {
    socket,
    messages,
    send: (m) => socket.send(JSON.stringify(m)),
    async wait(predicate, timeout = 5000) {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        const result = messages.find(predicate);
        if (result) return result;
        await sleep(10);
      }
      throw new Error('Timed out waiting for LAN state');
    },
  };
}
test('LAN config changes endpoint without changing production same-origin URLs or sessions', () => {
  const online = parseMultiplayerConfig({ mode: 'online', serverUrl: '' });
  assert.equal(
    new URL(multiplayerUrl(online, 'https://game.example', { room: 'EMBER' })).origin,
    'wss://game.example',
  );
  assert.equal(new URL(multiplayerUrl(online, 'http://localhost:3000', {})).pathname, '/ws');
  const lan = parseMultiplayerConfig({
    mode: 'lan',
    serverUrl: 'ws://10.10.10.1:8080',
    buildId: 'abc',
  });
  const a = multiplayerUrl(lan, 'http://localhost:4173', { name: 'Player 1', room: 'LAN' });
  const b = multiplayerUrl(lan, 'http://localhost:5173', { name: 'Player 1', room: 'LAN' });
  assert.equal(a, b);
  assert.equal(new URL(a).searchParams.get('build'), 'abc');
  assert.notEqual(multiplayerSessionKey(lan, 'EMBER'), multiplayerSessionKey(online, 'EMBER'));
  for (const config of [
    { mode: 'bad' },
    { mode: 'lan', serverUrl: '' },
    { mode: 'lan', serverUrl: 'https://example.com' },
  ])
    assert.throws(() => parseMultiplayerConfig(config));
});
test('settings preserve explicit port and reject WAN/DNS endpoints without executing shell syntax', async () => {
  assert.deepEqual(parseSettings('# test\nCLIENT_PORT=4173\nOPEN_BROWSER="0"'), {
    CLIENT_PORT: '4173',
    OPEN_BROWSER: '0',
  });
  const config = await readSettings(root, {
    MULTIPLAYER_SERVER_URL: 'ws://10.10.10.1:8081',
    OPEN_BROWSER: '0',
  });
  assert.equal(config.serverPort, 8081);
  assert.equal(config.openBrowser, false);
  for (const url of [
    'wss://10.10.10.1:8080',
    'ws://example.com:8080',
    'ws://8.8.8.8:8080',
    'ws://user:pass@10.10.10.1:8080',
    'ws://10.10.10.1:8080?name=bad',
  ])
    await assert.rejects(() => readSettings(root, { MULTIPLAYER_SERVER_URL: url }));
  await assert.rejects(() => readSettings(root, { CLIENT_PORT: 'abc' }));
});
test('two independent loopback asset servers share one LAN game server, movement, actions, world and resume', async (t) => {
  const game = createGameServer({
    port: 0,
    host: '0.0.0.0',
    serveAssets: false,
    expectedBuild: 'test-build',
    wsPaths: ['/'],
    tickMs: 20,
  });
  const address = await game.listen();
  t.after(() => game.close());
  assert.equal(address.address, '0.0.0.0');
  const serverUrl = `ws://127.0.0.1:${address.port}`;
  const config = { mode: 'lan', serverUrl, room: 'LAN-TEST', buildId: 'test-build' };
  const localUrls = [];
  for (let i = 0; i < 2; i++) {
    const client = createExhibitionClient({ root, port: 0, config });
    const local = await client.listen();
    t.after(() => client.close());
    assert.equal(local.address, '127.0.0.1');
    localUrls.push(`http://127.0.0.1:${local.port}`);
  }
  assert.notEqual(...localUrls);
  for (const base of localUrls) {
    const settings = await fetch(`${base}/multiplayer-config.json`);
    assert.equal(settings.headers.get('cache-control'), 'no-store');
    assert.equal((await settings.json()).serverUrl, serverUrl);
    const html = await fetch(base);
    assert.match(
      html.headers.get('content-security-policy'),
      /connect-src 'self' blob: ws:\/\/127\.0\.0\.1/,
    );
    assert.match(await html.text(), /\/vendor\/three.module.js/);
    assert.equal(
      (await fetch(`${base}/models/stone-axe/model.glb`, { method: 'HEAD' })).status,
      200,
    );
    assert.equal((await fetch(`${base}/vendor/three.module.js`)).status, 200);
    assert.equal((await fetch(`${base}/exhibition.env`)).status, 403);
  }
  const serverHttp = serverUrl.replace('ws:', 'http:');
  for (const asset of [
    '/',
    '/src/main.js',
    '/models/stone-axe/model.glb',
    '/vendor/three.module.js',
  ])
    assert.equal(
      (await fetch(serverHttp + asset)).status,
      404,
      'LAN server cannot serve game assets',
    );
  const a = peer(serverUrl, localUrls[0], 'Player 1'),
    b = peer(serverUrl, localUrls[1], 'Player 2');
  t.after(() => {
    a.socket.terminate();
    b.socket.terminate();
  });
  const aw = await a.wait((m) => m.type === 'welcome'),
    bw = await b.wait((m) => m.type === 'welcome');
  await a.wait((m) => m.type === 'state' && m.players.length === 2);
  await b.wait((m) => m.type === 'state' && m.players.length === 2);
  const room = game.rooms.get('LAN-TEST');
  const pa = room.players.get(aw.id),
    pb = room.players.get(bw.id);
  for (const [who, observer, p, dx] of [
    [a, b, pa, 1],
    [b, a, pb, -1],
  ]) {
    const x = p.x;
    for (let step = 0; step < 6; step++) {
      who.send({ type: 'move', dx, dz: 0, running: true });
      await sleep(70);
    }
    const state = await observer.wait(
      (m) =>
        m.type === 'state' &&
        m.players.some((q) => q.id === p.id && Math.abs(q.x - x) > 0.3 && q.moving && q.running),
    );
    assert.ok(state.players.find((q) => q.id === p.id).speed > 0);
    assert.ok(
      Math.abs(state.players.find((q) => q.id === p.id).facing - (Math.PI / 2) * dx) < 0.01,
    );
    who.send({ type: 'move', dx: 0, dz: 0 });
    who.send({ type: 'action', action: 'attack' });
    await observer.wait(
      (m) => m.type === 'state' && m.players.some((q) => q.id === p.id && q.attackSequence > 0),
    );
    assert.ok(state.enemies.length > 0);
    assert.ok(state.animals.length > 0);
  }
  // Explicit proximity fixture for an actual server-validated shared gather.
  await sleep(1100);
  const resource = room.resources.find((r) => r.type === 'berry' && r.amount > 0);
  Object.assign(pa, room.collision.nearestFree(resource, pa.radius, [], 3));
  const before = resource.amount,
    inventory = pa.inventory.berry;
  a.send({ type: 'action', action: 'gather', targetId: resource.id });
  await b.wait(
    (m) =>
      m.type === 'state' && m.resources?.some((r) => r.id === resource.id && r.amount < before),
  );
  assert.equal(pa.inventory.berry, inventory + 1);
  a.socket.terminate();
  await sleep(80);
  const rejoined = peer(serverUrl, localUrls[0], 'Player 1', 'test-build', aw.session);
  t.after(() => rejoined.socket.terminate());
  assert.equal((await rejoined.wait((m) => m.type === 'welcome')).resumed, true);
  assert.equal(
    (await rejoined.wait((m) => m.type === 'state')).players.find((p) => p.id === aw.id).inventory
      .berry,
    inventory + 1,
  );
  const health = await (await fetch(serverHttp + '/api/health')).json();
  assert.equal(health.buildId, 'test-build');
  assert.equal(health.players, 2);
});
test('LAN rejects wrong build and browser origin before allowing a player', async (t) => {
  const game = createGameServer({
    port: 0,
    host: '127.0.0.1',
    expectedBuild: 'right',
    wsPaths: ['/'],
    allowedOrigins: ['http://localhost:4173'],
  });
  const { port } = await game.listen();
  t.after(() => game.close());
  const wrong = peer(`ws://127.0.0.1:${port}`, 'http://localhost:4173');
  assert.equal((await wrong.wait((m) => m.type === 'error')).code, 'BUILD_MISMATCH');
  assert.equal(game.rooms.size, 0);
  const denied = new WebSocket(`ws://127.0.0.1:${port}`, { origin: 'https://unrelated.example' });
  await new Promise((resolve) =>
    denied.once('error', (error) => {
      assert.match(error.message, /403/);
      resolve();
    }),
  );
  assert.equal(game.rooms.size, 0);
});
const free = { move: (p, dx, dz) => ({ x: p.x + dx, z: p.z + dz }) };
const actor = () => ({
  id: 'a',
  x: 40,
  z: 50,
  species: 'cro',
  gender: 'female',
  facing: 0,
  radius: 0.36,
  attackSequence: 0,
  hurtSequence: 0,
  defeatSequence: 0,
  downedUntil: 0,
});
test('local prediction moves before another packet, bounds loss, reconciles and stops on damage/menu', () => {
  const prediction = new LocalPrediction();
  prediction.enabled = true;
  const p = actor();
  prediction.receive(p, 1000);
  prediction.setInput(1, 1, true, 1000);
  const next = prediction.step(0.016, 1016, 1016, free, []);
  assert.ok(next.x > p.x && next.z > p.z);
  assert.equal(p.x, 40, 'wire state is immutable');
  // One 16 ms run step (5.6 m/s) is 0.09 m; an unnormalized diagonal would be 0.127 m.
  assert.ok(Math.hypot(next.x - 40, next.z - 50) < 0.1, 'diagonal normalization');
  const x = next.x;
  prediction.step(0.016, 1300, 1300, free, []);
  assert.equal(next.x, x);
  prediction.receive({ ...p, x: 39, hurtSequence: 1 }, 1310);
  assert.equal(prediction.step(0.016, 1326, 1326, free, []).x, 39);
  prediction.setInput(1, 0, true, 1330);
  prediction.stop();
  assert.equal(prediction.step(0.016, 1346, 1346, free, []).x, 39);
  prediction.receive({ ...p, x: 80 }, 1400);
  assert.equal(prediction.actor.x, 80);
  prediction.receive(null, 1450);
  assert.equal(prediction.actor, null);
});
test('prediction obeys collision and authoritative attack lock', () => {
  const prediction = new LocalPrediction();
  prediction.enabled = true;
  prediction.receive(actor(), 1000);
  prediction.setInput(1, 0, true, 1000);
  assert.equal(prediction.step(0.02, 1020, 1020, { move: (p) => p }, []).x, 40);
  prediction.receive({ ...actor(), attackSequence: 1, attackAt: 1000 }, 1020);
  assert.equal(prediction.step(0.02, 1040, 1040, free, []).x, 40);
});
test('riding and boat prediction use configured speed, control radius and reset at dismount', () => {
  for (const vehicle of ['mountId', 'boatId']) {
    const prediction = new LocalPrediction();
    prediction.enabled = true;
    prediction.receive({ ...actor(), [vehicle]: 'vehicle', radius: 2 }, 1000);
    prediction.setInput(1, 0, true, 1000);
    let usedRadius;
    const next = prediction.step(
      0.05,
      1050,
      1050,
      {
        move: (p, dx, dz, r) => {
          usedRadius = r;
          return free.move(p, dx, dz);
        },
      },
      [],
      7,
    );
    assert.ok(Math.abs(next.x - 40.35) < 0.001);
    assert.equal(usedRadius, 2);
    prediction.receive(actor(), 1060);
    assert.equal(prediction.step(0.016, 1076, 1076, free, []).x, 40);
  }
});
test('offline package integrity catches a partial or modified copy', async () => {
  await mkdir(path.join(root, 'output'), { recursive: true });
  const folder = await mkdtemp(path.join(root, 'output/exhibition-integrity-'));
  await writeFile(path.join(folder, 'asset'), 'original');
  const files = [{ path: 'asset', sha256: await sha256(path.join(folder, 'asset')) }];
  await writeFile(
    path.join(folder, 'exhibition-build.json'),
    JSON.stringify({ files, buildId: buildId(files) }),
  );
  await verifyExhibition(folder);
  await writeFile(path.join(folder, 'asset'), 'changed');
  await assert.rejects(() => verifyExhibition(folder), /changed or missing/);
});
