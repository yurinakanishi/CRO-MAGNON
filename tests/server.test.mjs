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

function connect(url, room = 'TEST', name = '旅人', character = {}) {
  const socket = new WebSocket(`${url}?${new URLSearchParams({ ...character, room, name })}`);
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

test('female is the server default and all four appearances synchronize to peers', async (t) => {
  const { url } = await start(t);
  const appearances = [{}, { species: 'cro', gender: 'male' }, { species: 'nea', gender: 'female' }, { species: 'nea', gender: 'male' }, { species: 'nea', gender: 'invalid' }];
  const clients = appearances.map((appearance, index) => connect(url, 'APPEARANCE', `Character ${index}`, appearance));
  const states = await Promise.all(clients.map(client => client.wait(message => message.type === 'state' && message.players.length === 5)));
  const expected = ['cro/female', 'cro/male', 'nea/female', 'nea/female', 'nea/male'];
  for (const state of states) assert.deepEqual(state.players.map(player => `${player.species}/${player.gender}`).sort(), expected);
  assert.equal(states[0].npc.gender, 'male');
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
  assert.ok(traveled > .4 && traveled < .8, `Unexpected walking distance: ${traveled}`);
  const stopped = { x: player.x, z: player.z };
  await sleep(150);
  assert.equal(player.x, stopped.x);
  assert.equal(player.z, stopped.z);
});

test('run requests use the server speed and gait changes affect only live directional input', async (t) => {
  const { game, url } = await start(t),
    client = connect(url, 'GAIT');
  const { id } = await client.wait((m) => m.type === 'welcome');
  const p = game.rooms.get('GAIT').players.get(id);
  client.send({ type: 'move', dx: 1, dz: 0, running: false, speed: 900 });
  await client.wait((m) => m.type === 'state' && m.players[0].moving);
  assert.equal(p.target, null);
  assert.ok(p.speed <= 1.25001);
  client.send({ type: 'gait', running: true });
  const run = await client.wait((m) => m.type === 'state' && m.players[0].running);
  assert.ok(Math.abs(run.players[0].speed - 3.5) < 0.001);
  assert.equal(p.target, null);
  client.send({ type: 'move', dx: 0, dz: 0, running: false });
  await sleep(60);
  assert.equal(p.running, false);
  assert.equal(p.moving, false);
  assert.equal(p.target, null);
  assert.deepEqual(p.path, []);
});

test('unchanged world resources are not resent on movement ticks and static files revalidate from cache', async t => {
  const {url,http}=await start(t),client=connect(url,'DELTA');
  const initial=await client.wait(m=>m.type==='state'&&m.resources);
  const tick=await client.wait(m=>m.type==='state'&&!m.resources);
  assert.ok(tick.animals.length===2);assert.ok(JSON.stringify(tick).length<JSON.stringify(initial).length*.65);
  const asset=await fetch(`${http}/models/stone-axe/model.glb`,{method:'HEAD'});
  assert.ok(asset.headers.get('etag'));
  const cached=await fetch(`${http}/models/stone-axe/model.glb`,{headers:{'if-none-match':asset.headers.get('etag')}});
  assert.equal(cached.status,304);assert.equal((await cached.arrayBuffer()).byteLength,0);
  assert.equal((await fetch(`${http}/src/models.js`)).status,404);
  assert.equal((await fetch(`${http}/src/world.js`)).status,404);
});

test('depleted solid resources cannot regenerate inside a player',async t=>{
  const {game,url}=await start(t),client=connect(url,'REGROW');
  const {id}=await client.wait(m=>m.type==='welcome'),room=game.rooms.get('REGROW'),p=room.players.get(id),resource=room.resources[0];
  resource.amount=0;resource.regeneratedAt=Date.now()-21000;p.x=resource.x;p.z=resource.z;
  await sleep(80);assert.equal(resource.amount,0);
  p.x=49;p.z=54;await sleep(80);assert.equal(resource.amount,1);
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
  assert.deepEqual(player.inventory, { wood: 2, stone: 0, berry: 0, rawMeat: 0, cookedMeat: 0, obsidian: 0, seed: 0, water: 0, rawFish: 0, cookedFish: 0, rawShellfish: 0, cookedShellfish: 0, shells: 0, obsidianBlade:0,rootSeed:0,herbSeed:0,rawRoot:0,herb:0,cookedRoot:0,herbRoot:0 });
  player.lastAction = 0;
  client.send({ type: 'action', action: 'trade' });
  await client.wait((message) => message.type === 'notice' && message.text.startsWith('オルに近づいて'));
  assert.equal(player.inventory.berry, 0);
  player.x = 70;
  player.z = 41;
  player.lastAction = 0;
  client.send({ type: 'action', action: 'trade' });
  await client.wait((message) => message.type === 'notice' && message.text.includes('ベリー +3'));
  assert.deepEqual(player.inventory, { wood: 0, stone: 0, berry: 3, rawMeat: 0, cookedMeat: 0, obsidian: 0, seed: 0, water: 0, rawFish: 0, cookedFish: 0, rawShellfish: 0, cookedShellfish: 0, shells: 0, obsidianBlade:0,rootSeed:0,herbSeed:0,rawRoot:0,herb:0,cookedRoot:0,herbRoot:0 });
  const resource = room.resources[0];
  resource.amount = 0;
  resource.regeneratedAt = Date.now() - 21000;
  await client.wait((message) => message.type === 'state' && message.resources?.[0].amount === 1);
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
