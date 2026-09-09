import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createGameServer } from '../server.mjs';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
test('actual protocol ignores retired travel and preserves position and inventory', async (t) => {
  const game = createGameServer({ port: 0, host: '127.0.0.1', tickMs: 20 });
  await game.listen();
  const socket = new WebSocket(
      'ws://127.0.0.1:' + game.address().port + '/ws?room=PALEO&name=Explorer',
    ),
    messages = [];
  t.after(async () => {
    socket.terminate();
    await game.close();
  });
  socket.on('message', (data) => messages.push(JSON.parse(data)));
  const wait = async (predicate) => {
    for (let i = 0; i < 300; i++) {
      const found = messages.find(predicate);
      if (found) return found;
      await delay(10);
    }
    throw Error('Expected protocol event missing');
  };
  const { id } = await wait((m) => m.type === 'welcome'),
    p = game.rooms.get('PALEO').players.get(id);
  const original = structuredClone({ x: p.x, z: p.z, inventory: p.inventory });
  const send = (m) => socket.send(JSON.stringify(m));
  for (const command of [
    { type: 'target', x: 58, z: 46, running: true },
    { type: 'target', x: -999, z: -999 },
    { type: 'expedition', destination: 'sahul', inventory: { wood: 999 } },
    { type: 'expedition', destination: 'gulf-hearth' },
    { type: 'expedition', destination: 'anywhere' },
  ])
    send(command);
  send({ type: 'ping', at: 'travel-rejected' });
  await wait((m) => m.type === 'pong' && m.at === 'travel-rejected');
  await delay(200);
  assert.deepEqual({ x: p.x, z: p.z, inventory: p.inventory }, original);
  assert.equal(p.target, null);
  const health = await (
    await fetch('http://127.0.0.1:' + game.address().port + '/api/health')
  ).json();
  assert.equal(health.worldWidth, 8192);
  assert.equal(health.epochYearsBP, 50000);
});
