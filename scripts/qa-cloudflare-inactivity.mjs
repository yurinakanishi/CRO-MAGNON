import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { IDLE_CLOSE_CODE, IDLE_TIMEOUT_MS } from '../dist/shared/player-inactivity.mjs';

const folder = `output/cloudflare-inactivity-${Date.now()}`;
await mkdir(folder, { recursive: true });
const scriptPath = `${folder}/worker.js`;
await build({
  entryPoints: ['dist/cloudflare/worker.mjs'],
  outfile: scriptPath,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  external: ['cloudflare:workers'],
});
const mf = new Miniflare({
  ...convertV4MiniflareOptions({
    name: 'idle-test',
    modules: true,
    scriptPath,
    compatibilityDate: '2026-09-07',
    compatibilityFlags: ['nodejs_compat'],
    bindings: { SERVICE_ENABLED: 'true' },
    durableObjects: { GAME: { className: 'FreeGameRoom', useSQLite: true } },
  }),
  unsafeInspectDurableObjects: true,
});
const checks = [],
  sockets = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const pass = (label) => {
  checks.push(label);
  console.log('PASS', label);
};
async function until(predicate, label, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await predicate();
    if (result) return result;
    await sleep(50);
  }
  throw new Error(`Timed out: ${label}`);
}
async function open(session) {
  const response = await mf.dispatchFetch(
    `http://localhost/ws?${new URLSearchParams({ room: 'EMBER', name: 'Idle QA', resume: '1', ...(session ? { session } : {}) })}`,
    { headers: { Upgrade: 'websocket' } },
  );
  assert.equal(response.status, 101);
  const socket = response.webSocket;
  const client = { socket, messages: [], closed: null, connectedAt: Date.now() };
  socket.addEventListener('message', (event) => client.messages.push(JSON.parse(event.data)));
  socket.addEventListener('close', (event) => {
    client.closed = { code: event.code, at: Date.now() };
  });
  socket.accept();
  sockets.push(socket);
  client.wait = (predicate, label, timeout) =>
    until(() => client.messages.find(predicate), label, timeout);
  return client;
}
const status = async () => (await mf.dispatchFetch('http://localhost/api/status')).json();
let heartbeat;
try {
  const setup = await open();
  const welcome = await setup.wait((message) => message.type === 'welcome', 'setup welcome');
  setup.socket.close();
  await until(async () => (await status()).players === 0, 'setup disconnected');
  const storage = await mf.unsafeGetDurableObjectStorage('idle-test', 'FreeGameRoom', {
    name: 'EMBER',
  });
  const read = async () => (await storage.exec('SELECT data FROM checkpoint WHERE id = 1'))[0].data;
  // This is the isolated emulator's test fixture, never a live checkpoint or user save.
  const seed = JSON.parse(await read());
  const savedPlayer = seed.game.rooms[0].sessions[0].player;
  savedPlayer.inventory.wood = 7;
  savedPlayer.gathered = 9;
  savedPlayer.mascot = '524';
  await storage.exec('UPDATE checkpoint SET data = ? WHERE id = 1', JSON.stringify(seed));
  await mf.unsafeEvictDurableObject('idle-test', 'FreeGameRoom', {
    name: 'EMBER',
    webSockets: 'close',
  });
  const client = await open(welcome.session);
  assert.equal(
    (await client.wait((message) => message.type === 'welcome', 'idle client welcome')).id,
    welcome.id,
  );
  let heartbeatsSent = 0;
  heartbeat = setInterval(() => {
    if (!client.closed) {
      client.socket.send(JSON.stringify({ type: 'ping', at: Date.now() }));
      heartbeatsSent++;
    }
  }, 1000);
  await until(() => client.closed, 'actual Worker idle close', IDLE_TIMEOUT_MS + 5000);
  clearInterval(heartbeat);
  assert.equal(client.closed.code, IDLE_CLOSE_CODE);
  assert.ok(client.messages.some((message) => message.code === 'IDLE_TIMEOUT'));
  const idleElapsedMs = client.closed.at - client.connectedAt;
  assert.ok(
    idleElapsedMs >= IDLE_TIMEOUT_MS - 100 && idleElapsedMs < IDLE_TIMEOUT_MS + 1500,
    `${idleElapsedMs} ms`,
  );
  assert.ok(heartbeatsSent >= 20);
  await until(async () => (await status()).players === 0, 'Worker slot released');
  pass('The actual SQLite-backed Worker exits after 30 seconds while receiving heartbeat messages');
  await sleep(200);
  const checkpoint = await read();
  const session = JSON.parse(checkpoint).game.rooms[0].sessions.find(
    (entry) => entry.token === welcome.session,
  );
  assert.equal(session.player.inventory.wood, 7);
  assert.equal(session.player.mascot, '524');
  assert.equal(session.player.lastActivityAt, undefined);
  await sleep(2200);
  assert.equal(await read(), checkpoint, 'the empty room performs no further simulation saves');
  pass(
    'Disconnect saves belongings and companion choice, releases the slot, and stops the empty-room timer',
  );
  const resumed = await open(welcome.session);
  const returned = await resumed.wait(
    (message) => message.type === 'welcome',
    'manual Worker resume',
  );
  assert.equal(returned.id, welcome.id);
  assert.equal(returned.resumed, true);
  const state = await resumed.wait((message) => message.type === 'state', 'resumed state');
  const player = state.players.find((entry) => entry.id === welcome.id);
  assert.equal(player.inventory.wood, 7);
  assert.equal(player.gathered, 9);
  assert.equal(player.mascot, '524');
  pass('A later explicit connection resumes the same saved traveller');
  resumed.socket.close();
  await until(async () => (await status()).players === 0, 'final room empty');
  const workerSHA256 = createHash('sha256')
    .update(await readFile(scriptPath))
    .digest('hex');
  const report = {
    checkedAt: new Date().toISOString(),
    status: 'passed',
    environment: 'isolated Miniflare SQLite Durable Object',
    idleElapsedMs,
    heartbeatsSent,
    checks,
    workerSHA256,
    finalPlayers: 0,
    livePublicDeploymentTested: false,
  };
  await writeFile(`${folder}/report.json`, JSON.stringify(report, null, 2));
  console.log('Evidence:', folder);
} finally {
  clearInterval(heartbeat);
  for (const socket of sockets)
    try {
      socket.close();
    } catch {}
  await mf.dispose();
}
