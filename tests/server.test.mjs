import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createGameServer } from '../server.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function start(t) {
  const game = createGameServer({ port: 0, host: '127.0.0.1', tickMs: 20 });
  await game.listen();
  t.after(() => game.close());
  return { game, url: `ws://127.0.0.1:${game.address().port}/ws`, http: `http://127.0.0.1:${game.address().port}` };
}

function connect(url, room = 'TEST', name = '旅人') {
  const socket = new WebSocket(`${url}?room=${room}&name=${encodeURIComponent(name)}`);
  const messages = [];
  socket.on('message', (data) => messages.push(JSON.parse(data.toString())));
  socket.on('error', () => {});
  return {
    socket, messages,
    send: (message) => socket.send(JSON.stringify(message)),
    async wait(predicate, timeout = 3000) {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        const found = messages.find(predicate);
        if (found) return found;
        await sleep(10);
      }
      throw new Error(`Timed out waiting for message. Received types: ${messages.map((message) => message.type).join(', ')}`);
    },
  };
}

test('five actual clients synchronize, sixth is refused, and rooms are isolated', async (t) => {
  const { game, url } = await start(t);
  const clients = Array.from({ length: 5 }, (_, index) => connect(url, 'CAMP', `旅人${index + 1}`));
  const welcomes = await Promise.all(clients.map((client) => client.wait((message) => message.type === 'welcome')));
  assert.equal(new Set(welcomes.map((message) => message.id)).size, 5);
  const states = await Promise.all(clients.map((client) => client.wait((message) => message.type === 'state' && message.players.length === 5)));
  assert.deepEqual(states[0].players.map((player) => player.id).sort(), states[4].players.map((player) => player.id).sort());
  const extra = connect(url, 'CAMP', '6人目');
  assert.equal((await extra.wait((message) => message.type === 'error')).code, 'ROOM_FULL');
  const separate = connect(url, 'OTHER', '別の谷');
  const state = await separate.wait((message) => message.type === 'state');
  assert.equal(state.players.length, 1);
  assert.equal(game.rooms.size, 2);
  const disconnectId = welcomes[4].id;
  clients[4].socket.close();
  await clients[0].wait((message) => message.type === 'state' && message.players.length === 4 && !message.players.some((player) => player.id === disconnectId));
  separate.socket.close();
  await sleep(40);
  assert.equal(game.rooms.has('OTHER'), false);
});

test('resource gathering and camp completion are decided by the server', async (t) => {
  const { game, url } = await start(t);
  const client = connect(url);
  const { id } = await client.wait((message) => message.type === 'welcome');
  const room = game.rooms.get('TEST');
  const player = room.players.get(id);
  player.x = 3;
  player.z = 3;
  client.send({ type: 'action', action: 'gather', inventory: { wood: 999 } });
  await client.wait((message) => message.type === 'notice' && message.tone === 'error');
  assert.equal(player.inventory.wood, 0);
  const wood = room.resources.find((resource) => resource.type === 'wood');
  player.x = wood.x;
  player.z = wood.z;
  player.lastAction = 0;
  const previous = wood.amount;
  client.send({ type: 'action', action: 'gather' });
  await client.wait((message) => message.type === 'notice' && message.text === '木材 +1');
  assert.equal(player.inventory.wood, 1);
  assert.equal(wood.amount, previous - 1);
  player.inventory.wood = 12;
  player.inventory.stone = 6;
  player.lastAction = 0;
  client.send({ type: 'action', action: 'contribute' });
  await client.wait((message) => message.type === 'notice' && message.text.startsWith('焚き火に近づいて'));
  assert.equal(room.camp.wood, 0);
  player.x = 50;
  player.z = 50;
  player.lastAction = 0;
  client.send({ type: 'action', action: 'contribute' });
  const complete = await client.wait((message) => message.type === 'state' && message.completed);
  assert.equal(complete.camp.level, 1);
  assert.equal(complete.players[0].ready, true);
  assert.equal(player.inventory.wood, 0);
  assert.equal(player.inventory.stone, 0);
});

test('movement is normalized, times out, and ignores client-authored position', async (t) => {
  const { game, url } = await start(t);
  const client = connect(url);
  const { id } = await client.wait((message) => message.type === 'welcome');
  const player = game.rooms.get('TEST').players.get(id);
  const origin = { x: player.x, z: player.z };
  client.send({ type: 'move', dx: 1000, dz: 1000, x: 99999, z: 99999 });
  await sleep(700);
  const traveled = Math.hypot(player.x - origin.x, player.z - origin.z);
  assert.ok(traveled > 2 && traveled < 4.5, `Unexpected travel distance: ${traveled}`);
  const stopped = { x: player.x, z: player.z };
  await sleep(150);
  assert.equal(player.x, stopped.x);
  assert.equal(player.z, stopped.z);
});

test('crafting, trading, and regeneration enforce resource costs and proximity', async (t) => {
  const { game, url } = await start(t);
  const client = connect(url);
  const { id } = await client.wait((message) => message.type === 'welcome');
  const room = game.rooms.get('TEST');
  const player = room.players.get(id);
  client.send({ type: 'action', action: 'craft', wood: 3, stone: 2 });
  await client.wait((message) => message.type === 'notice' && message.text.startsWith('石斧には'));
  assert.equal(player.tool, false);
  player.inventory.wood = 5;
  player.inventory.stone = 2;
  player.lastAction = 0;
  client.send({ type: 'action', action: 'craft' });
  await client.wait((message) => message.type === 'state' && message.players[0].tool);
  assert.deepEqual(player.inventory, { wood: 2, stone: 0, berry: 0 });
  player.lastAction = 0;
  client.send({ type: 'action', action: 'trade' });
  await client.wait((message) => message.type === 'notice' && message.text.startsWith('オルに近づいて'));
  assert.equal(player.inventory.berry, 0);
  player.x = 70;
  player.z = 41;
  player.lastAction = 0;
  client.send({ type: 'action', action: 'trade' });
  await client.wait((message) => message.type === 'notice' && message.text.includes('ベリー +3'));
  assert.deepEqual(player.inventory, { wood: 0, stone: 0, berry: 3 });
  const resource = room.resources[0];
  resource.amount = 0;
  resource.regeneratedAt = Date.now() - 21000;
  await client.wait((message) => message.type === 'state' && message.resources[0].amount === 1);
  assert.equal(resource.amount, 1);
});

test('chat uses the authenticated player name and is confined to its room', async (t) => {
  const { url, http } = await start(t);
  const sender = connect(url, 'CHAT', 'アオ');
  const receiver = connect(url, 'CHAT', 'モリ');
  const other = connect(url, 'ELSE');
  await Promise.all([sender, receiver, other].map((client) => client.wait((message) => message.type === 'welcome')));
  sender.send({ type: 'chat', text: '火を守ろう！', name: '偽の名前', system: true });
  const message = await receiver.wait((item) => item.type === 'chat' && item.text === '火を守ろう！');
  assert.equal(message.name, 'アオ');
  assert.equal(message.system, undefined);
  assert.equal(other.messages.some((item) => item.text === '火を守ろう！'), false);
  const health = await (await fetch(`${http}/api/health`)).json();
  assert.equal(health.players, 3);
  assert.equal(health.maxPlayers, 5);
  const privateFile = await fetch(`${http}/server.mjs`);
  assert.equal(privateFile.status, 404);
  const shared = await fetch(`${http}/shared/world.mjs`);
  assert.equal(shared.status, 200);
  const traversal = await fetch(`${http}/src/%2e%2e%5cserver.mjs`);
  assert.equal(traversal.status, 403);
});
