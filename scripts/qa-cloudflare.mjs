import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const base = process.argv[2] || 'http://127.0.0.1:8787';
const pause = ms => new Promise(r => setTimeout(r, ms));
const clients = [];
function join(name, session) {
  const ws = new WebSocket(`${base.replace(/^http/, 'ws')}/ws?${new URLSearchParams({ room: 'EMBER', name, resume: '1', ...(session ? { session } : {}) })}`);
  const messages = []; ws.on('message', data => messages.push(JSON.parse(data))); ws.on('error', () => {});
  const client = { ws, messages, async wait(predicate) {
    for (let i = 0; i < 400; i++) { const result = messages.find(predicate); if (result) return result; await pause(25); }
    throw new Error(`No expected message for ${name}: ${JSON.stringify(messages.slice(-2))}`);
  } };
  clients.push(client); return client;
}
try {
  assert.equal((await fetch(`${base}/api/health`).then(r => r.json())).hosting, 'cloudflare-free');
  for (const url of ['/.env', '/server.mjs', '/models/cro-magnon-hunter/preview.glb']) assert.equal((await fetch(base + url)).status, 404);
  const peers = Array.from({ length: 5 }, (_, i) => join(`Cloud QA ${i}`));
  const welcome = await Promise.all(peers.map(c => c.wait(m => m.type === 'welcome')));
  await Promise.all(peers.map(c => c.wait(m => m.type === 'state' && m.players.length === 5)));
  const extra = join('Sixth'); assert.equal((await extra.wait(m => m.type === 'error')).code, 'ROOM_FULL');
  const before = peers[0].messages.find(m => m.type === 'state').players.find(p => p.id === welcome[0].id);
  peers[0].ws.send(JSON.stringify({ type: 'move', dx: -1, dz: 0, running: true }));
  await pause(450); peers[0].ws.send(JSON.stringify({ type: 'move', dx: 0, dz: 0 }));
  const moved = await peers[1].wait(m => m.type === 'state' && m.players.some(p => p.id === welcome[0].id && p.x < before.x - 0.1));
  peers[0].ws.send(JSON.stringify({ type: 'action', action: 'attack' }));
  await peers[1].wait(m => m.type === 'state' && m.players.some(p => p.id === welcome[0].id && p.attackSequence > 0));
  peers[0].ws.close(); await pause(350);
  const back = join('Ignored replacement name', welcome[0].session);
  const resumed = await back.wait(m => m.type === 'welcome');
  assert.equal(resumed.resumed, true); assert.equal(resumed.id, welcome[0].id);
  const build = JSON.parse(await readFile('assets/cloudflare/build.json'));
  for (const record of build.models) {
    const response = await fetch(base + record.url); assert.equal(response.status, 200, record.url);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(createHash('sha256').update(bytes).digest('hex'), record.sha256, record.url);
  }
  const result = { checkedAt: new Date().toISOString(), base, status: 'passed', fiveClients: true, sixthRefused: true,
    movement: true, attack: true, reconnect: true, privateFilesNotServed: true, verifiedGLBs: build.models.length,
    stateSamples: peers.reduce((sum, peer) => sum + peer.messages.filter(m => m.type === 'state').length, 0) };
  await mkdir('assets/cloudflare', { recursive: true });
  await writeFile(`assets/cloudflare/${base.startsWith('http://127.') ? 'local' : 'live'}-qa.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  for (const { ws } of clients) if (ws.readyState === 1) { ws.send(JSON.stringify({ type: 'leave' })); ws.close(); } else ws.terminate();
}
