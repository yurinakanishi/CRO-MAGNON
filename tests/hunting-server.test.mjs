import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createGameServer } from '../server.mjs';
import { CollisionWorld } from '../shared/collision.mjs';
import { HUNTING } from '../shared/hunting.mjs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function start(t) {
  const game = createGameServer({ port: 0, host: '127.0.0.1', tickMs: 20 });
  await game.listen(); t.after(() => game.close());
  return { game, url: `ws://127.0.0.1:${game.address().port}/ws` };
}
function connect(url, room = 'HUNT', name = 'Hunter') {
  const socket = new WebSocket(`${url}?${new URLSearchParams({ room, name })}`), messages = [];
  socket.on('message', data => messages.push(JSON.parse(data.toString()))); socket.on('error', () => {});
  return {
    messages, socket, send: message => socket.send(JSON.stringify(message)),
    async wait(predicate, timeout = 4000, from = 0) {
      const end = Date.now() + timeout;
      while (Date.now() < end) {
        const found = messages.slice(from).find(predicate); if (found) return found;
        await sleep(10);
      }
      throw new Error(`Timed out: ${JSON.stringify(messages.slice(-3))}`);
    },
  };
}

test('five sockets share damage and exactly four meat; meat cooks at the level-zero fire before it can be eaten', async t => {
  const { game, url } = await start(t);
  const clients = Array.from({ length: 5 }, (_, index) => connect(url, 'TEAM', `Hunter${index}`));
  const welcomes = await Promise.all(clients.map(client => client.wait(message => message.type === 'welcome')));
  const room = game.rooms.get('TEAM'), mammoth = room.animals[0]; mammoth.age = 30;
  const players = welcomes.map(({ id }) => room.players.get(id));
  for (const [i, player] of players.entries()) Object.assign(player, { x: mammoth.x + Math.sin(i * Math.PI * 2 / 5) * 4.3, z: mammoth.z + Math.cos(i * Math.PI * 2 / 5) * 4.3 });
  for (const client of clients.slice(0, 4)) client.send({ type: 'action', action: 'attack', targetId: mammoth.id, damage: 10000, health: 0, inventory: { rawMeat: 99 } });
  const dying = await Promise.all(clients.map(client => client.wait(message => message.type === 'state' && message.animals[0].phase === 'dying')));
  for (const state of dying) { assert.equal(state.animals[0].health, 0); assert.equal(state.animals[0].meatRemaining, 0); assert.equal(state.animals[0].clip, 'Death'); }
  assert.ok(dying[0].animals[0].phaseStartedAt >= Math.max(...players.slice(0, 4).map(player => player.attackAt)) + HUNTING.attackImpactMs);
  assert.equal(players.reduce((sum, player) => sum + player.attackSequence, 0), 4);
  assert.equal(players.reduce((sum, player) => sum + player.inventory.rawMeat, 0), 0);
  const meat = await clients[0].wait(message => message.type === 'state' && message.animals[0].phase === 'meat');
  assert.ok(meat.animals[0].phaseStartedAt - dying[0].animals[0].phaseStartedAt >= HUNTING.deathDurationMs);
  assert.equal(meat.animals[0].meatRemaining, 4);
  for (const [i, player] of players.entries()) Object.assign(player, { x: mammoth.x + Math.sin(i * Math.PI * 2 / 5), z: mammoth.z + Math.cos(i * Math.PI * 2 / 5), lastAction: 0 });
  for (const client of clients) client.send({ type: 'action', action: 'harvest', targetId: mammoth.id, amount: 99 });
  await Promise.all(clients.map(client => client.wait(message => message.type === 'state' && message.animals[0].phase === 'respawning')));
  assert.equal(players.reduce((sum, player) => sum + player.inventory.rawMeat, 0), 4);
  assert.equal(mammoth.meatRemaining, 0);
  const eaterIndex = players.findIndex(player => player.inventory.rawMeat > 0), eater = players[eaterIndex], client = clients[eaterIndex];
  eater.energy = 40; eater.lastAction = 0;
  const rawBefore = eater.inventory.rawMeat;
  let mark = client.messages.length;
  client.send({ type: 'action', action: 'eatMeat', rawMeat: 0, cookedMeat: 99, energy: 100 });
  await client.wait(message => message.type === 'notice' && message.tone === 'error', 4000, mark);
  assert.equal(eater.energy, 40); assert.equal(eater.inventory.rawMeat, rawBefore);
  Object.assign(eater, { x: 50, z: 52, lastAction: 0 }); mark = client.messages.length;
  client.send({ type: 'action', action: 'cook', cookingEndsAt: 1 });
  const cooking = await client.wait(message => message.type === 'state' && message.players.some(player => player.id === eater.id && player.cookingEndsAt > message.serverTime), 4000, mark);
  assert.equal(room.camp.level, 0);
  const deadline = cooking.players.find(player => player.id === eater.id).cookingEndsAt;
  assert.ok(deadline - cooking.serverTime >= 2900 && deadline - cooking.serverTime <= 3000);
  await client.wait(message => message.type === 'state' && message.players.some(player => player.id === eater.id && player.inventory.cookedMeat === 1), 4000, mark);
  assert.equal(eater.inventory.rawMeat, rawBefore - 1); assert.equal(eater.cookingEndsAt, 0);
  eater.lastAction = 0; mark = client.messages.length;
  client.send({ type: 'action', action: 'eatMeat' });
  await client.wait(message => message.type === 'state' && message.players.some(player => player.id === eater.id && player.energy === 85), 4000, mark);
  assert.equal(eater.inventory.cookedMeat, 0);
});

test('socket swings ignore forged range and IDs, enforce impact collision and cooldown, and briefly hold position', async t => {
  const { game, url } = await start(t), client = connect(url, 'GUARDS');
  const { id } = await client.wait(message => message.type === 'welcome');
  const room = game.rooms.get('GUARDS'), player = room.players.get(id), mammoth = room.animals[0]; mammoth.age = 30;
  let mark = client.messages.length;
  client.send({ type: 'action', action: 'attack', targetId: mammoth.id, x: mammoth.x, z: mammoth.z });
  await client.wait(message => message.type === 'state' && message.players[0].attackSequence === 1, 4000, mark);
  await sleep(HUNTING.attackImpactMs + 30); assert.equal(mammoth.health, 100);
  player.attackAt = Date.now() - HUNTING.attackCooldownMs - 1;
  Object.assign(player, { x: mammoth.x, z: mammoth.z + 4, lastAction: 0 }); mark = client.messages.length;
  client.send({ type: 'action', action: 'attack', targetId: mammoth.id });
  const windup = await client.wait(message => message.type === 'state' && message.players[0].attackSequence === 2, 4000, mark);
  assert.equal(windup.animals[0].health, 100); assert.equal(windup.animals[0].phase, 'alive');
  await client.wait(message => message.type === 'state' && message.animals[0].health === 75, 4000, mark);
  const origin = { x: player.x, z: player.z }; player.lastAction = 0; mark = client.messages.length;
  client.send({ type: 'move', dx: 1, dz: 0, running: true });
  client.send({ type: 'action', action: 'attack', targetId: mammoth.id });
  await client.wait(message => message.type === 'notice' && message.text.includes('構え直'), 4000, mark);
  await sleep(150);
  assert.equal(mammoth.health, 75); assert.equal(player.attackSequence, 2);
  assert.equal(player.x, origin.x); assert.equal(player.z, origin.z); assert.equal(player.moving, false);
  player.attackAt = Date.now() - HUNTING.attackCooldownMs - 1; player.lastInput = 0; player.lastAction = 0;
  room.collision = new CollisionWorld([{ id: 'wall', type: 'box', x: mammoth.x, z: mammoth.z + 2, hx: 1, hz: .1, c: 1, s: 0, height: 3 }], { river: false });
  mark = client.messages.length;
  client.send({ type: 'action', action: 'attack', targetId: mammoth.id });
  await client.wait(message => message.type === 'state' && message.players[0].attackSequence === 3, 4000, mark);
  await sleep(HUNTING.attackImpactMs + 30);
  assert.equal(mammoth.health, 75);
  player.attackAt = Date.now() - HUNTING.attackCooldownMs - 1; player.lastAction = Date.now(); mark = client.messages.length;
  client.send({ type: 'action', action: 'attack', targetId: { id: mammoth.id } });
  await client.wait(message => message.type === 'state' && message.players[0].attackSequence === 4, 4000, mark);
  await sleep(HUNTING.attackImpactMs + 30);
  assert.equal(mammoth.health, 75);
});

test('five sockets see an empty-air attack and attack immediately interrupts cooking independently of action cooldown', async t => {
  const { game, url } = await start(t), clients = Array.from({ length: 5 }, (_, i) => connect(url, 'AIR', `Hunter${i}`));
  const welcomes = await Promise.all(clients.map(client => client.wait(message => message.type === 'welcome')));
  const room = game.rooms.get('AIR'), player = room.players.get(welcomes[0].id); room.animals = [];
  Object.assign(player, { x: 50, z: 52, facing: 1.2 }); player.inventory.rawMeat = 1;
  clients[0].send({ type: 'action', action: 'cook' });
  await clients[0].wait(message => message.type === 'state' && message.players.some(p => p.id === player.id && p.cookingEndsAt > 0));
  clients[0].send({ type: 'action', action: 'attack', facing: Math.PI, targetId: 'missing', damage: 999, health: 0 });
  const states = await Promise.all(clients.map(client => client.wait(message => message.type === 'state' && message.players.some(p => p.id === player.id && p.attackSequence === 1))));
  for (const state of states) {
    const actor = state.players.find(p => p.id === player.id);
    assert.equal(actor.cookingEndsAt, 0); assert.equal(actor.facing, 1.2); assert.equal(actor.moving, false);
    assert.equal(actor.inventory.rawMeat, 1); assert.equal(actor.inventory.cookedMeat, 0); assert.equal(state.animals.length, 0);
  }
  assert.equal(player.attackSequence, 1);
  clients[0].send({ type: 'action', action: 'attack' }); await sleep(80);
  assert.equal(player.attackSequence, 1);
});

test('server snapshots synchronize generic hostile enemy damage and death without dropping mammoth meat', async t => {
  const { game, url } = await start(t), client = connect(url, 'ENEMY');
  const { id } = await client.wait(message => message.type === 'welcome'), room = game.rooms.get('ENEMY'), player = room.players.get(id);
  room.animals = []; Object.assign(player, { x: 25, z: 21, facing: 0 });
  const enemy = { id: 'hostile-test', name: '敵', hostile: true, x: 25, z: 23, radius: .6, health: 25, maxHealth: 25, phase: 'alive' }; room.enemies.push(enemy);
  client.send({ type: 'action', action: 'attack' });
  const state = await client.wait(message => message.type === 'state' && message.enemies?.some(item => item.id === enemy.id && item.phase === 'dead'));
  const defeated = state.enemies.find(item => item.id === enemy.id);
  assert.equal(defeated.health, 0); assert.equal(defeated.clip, 'Death');
  assert.equal(enemy.alive, false); assert.equal(enemy.meatRemaining, undefined); assert.equal(player.inventory.rawMeat, 0);
});

test('disconnecting during windup discards the pending strike', async t => {
  const { game, url } = await start(t), hunter = connect(url, 'LEAVE', 'Hunter'), observer = connect(url, 'LEAVE', 'Observer');
  const { id } = await hunter.wait(message => message.type === 'welcome');
  await observer.wait(message => message.type === 'welcome');
  const room = game.rooms.get('LEAVE'), player = room.players.get(id), mammoth = room.animals[0]; mammoth.age = 30;
  Object.assign(player, { x: mammoth.x, z: mammoth.z + 4 });
  hunter.send({ type: 'action', action: 'attack', targetId: mammoth.id });
  await observer.wait(message => message.type === 'state' && message.players.some(member => member.id === id && member.attackSequence === 1));
  hunter.socket.close();
  await observer.wait(message => message.type === 'state' && message.players.length === 1);
  await sleep(HUNTING.attackImpactMs + 40);
  assert.equal(mammoth.health, 100); assert.equal(mammoth.phase, 'alive'); assert.equal(player.pendingStrike, null);
});

test('walking away cancels cooking through the real server and raw meat is retained', async t => {
  const { game, url } = await start(t), client = connect(url, 'CANCEL');
  const { id } = await client.wait(message => message.type === 'welcome'), player = game.rooms.get('CANCEL').players.get(id);
  Object.assign(player, { x: 50, z: 53.2 }); player.inventory.rawMeat = 1;
  client.send({ type: 'action', action: 'cook' });
  await client.wait(message => message.type === 'state' && message.players[0].cookingEndsAt > 0);
  const mark = client.messages.length;
  client.send({ type: 'move', dx: 0, dz: 1, running: true });
  await client.wait(message => message.type === 'notice' && message.text.includes('火から離れた'), 4000, mark);
  assert.equal(player.cookingEndsAt, 0); assert.equal(player.inventory.rawMeat, 1); assert.equal(player.inventory.cookedMeat, 0);
});

test('explicit cooking cancellation is responsive even immediately after starting', async t => {
  const { game, url } = await start(t), client = connect(url, 'CANCEL-NOW');
  const { id } = await client.wait(message => message.type === 'welcome'), player = game.rooms.get('CANCEL-NOW').players.get(id);
  Object.assign(player, { x: 50, z: 52 }); player.inventory.rawMeat = 1;
  client.send({ type: 'action', action: 'cook' });
  await client.wait(message => message.type === 'state' && message.players[0].cookingEndsAt > 0);
  const mark = client.messages.length, startedAt = player.lastAction;
  assert.ok(Date.now() - startedAt < 450);
  client.send({ type: 'action', action: 'cancelCook' });
  await client.wait(message => message.type === 'state' && message.players[0].cookingEndsAt === 0, 1000, mark);
  assert.equal(player.inventory.rawMeat, 1); assert.equal(player.inventory.cookedMeat, 0);
});
