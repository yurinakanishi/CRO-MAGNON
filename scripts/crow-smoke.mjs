import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket } from 'ws';
import { createGameServer } from '../server.mjs';
import { CollisionWorld, overlap } from '../shared/collision.mjs';
import { withinSpearReach, inAttackArc, enemyIsSolid } from '../shared/combat.mjs';
import { animalIsSolid } from '../shared/hunting.mjs';
import { CHARACTER_MODELS } from '../shared/characters.mjs';
import { ENEMY_RULES } from '../shared/enemies.mjs';

// Real-clock, public-protocol integration check. The room and actors are never
// modified directly; navigation and attacks use the same messages as the UI.
const output = resolve(process.argv[2] || 'assets/crow-network-qa.json');
const game = createGameServer({ port: 0, host: '127.0.0.1' });
const clients = [], resourceAmounts = new Map();
const collision = new CollisionWorld(undefined, { active: obstacle => !obstacle.resourceId || (resourceAmounts.get(obstacle.resourceId) ?? 1) > 0 });
const report = {
  startedAt: new Date().toISOString(), mode: 'real-clock-public-websocket-protocol',
  status: 'running', snapshots: 0, maxPlayers: 0, enemyHealth: [], phases: [], clips: [],
  statesPerClient: [], staticPenetrations: 0, dynamicPenetrations: 0, errors: [],
};
const send = (client, data) => client.socket.send(JSON.stringify(data));
const me = client => client.state?.players.find(p => p.id === client.id);
const enemy = client => client.state?.enemies?.find(e => e.modelKey === 'crow-shaman');
async function waitFor(label, condition, milliseconds = 8000) {
  const until = Date.now() + milliseconds;
  while (Date.now() < until) {
    if (condition()) return;
    await delay(50);
  }
  throw new Error(`${label} timed out`);
}
function observe(client, state) {
  client.state = state; client.states++;
  if (client !== clients[0]) return;
  report.snapshots++; report.maxPlayers = Math.max(report.maxPlayers, state.players.length);
  for (const resource of state.resources || []) resourceAmounts.set(resource.id, resource.amount);
  const crow = enemy(client);
  if (crow) {
    for (const [field, value] of [['enemyHealth', crow.health], ['phases', crow.phase], ['clips', crow.clip]]) {
      if (!report[field].includes(value)) report[field].push(value);
    }
    report.lastEnemy = { x: crow.x, z: crow.z, health: crow.health, phase: crow.phase };
  }
  const actors = [...state.players, ...state.animals.filter(animalIsSolid), ...(state.enemies || []).filter(enemyIsSolid)];
  for (const actor of actors) if (!collision.free(actor, actor.radius)) report.staticPenetrations++;
  for (let a = 0; a < actors.length; a++) for (let b = a + 1; b < actors.length; b++) {
    if (overlap(actors[a], actors[a].radius, { ...actors[b], type: 'circle' })) report.dynamicPenetrations++;
  }
}

try {
  const address = await game.listen();
  const url = `ws://127.0.0.1:${address.port}/ws`;
  const humanProfiles = CHARACTER_MODELS.filter(p => p.species === 'cro' || p.species === 'nea');
  const profiles = [...humanProfiles, humanProfiles[0]];
  for (const [index, profile] of profiles.entries()) {
    const socket = new WebSocket(`${url}?${new URLSearchParams({ room: 'CROW-NETWORK-QA', name: `Crow-QA-${index + 1}`, species: profile.species, gender: profile.gender })}`);
    const client = { socket, id: null, state: null, states: 0 }; clients.push(client);
    socket.on('error', e => report.errors.push(e.message));
    socket.on('message', bytes => {
      const message = JSON.parse(bytes.toString());
      if (message.type === 'welcome') client.id = message.id;
      if (message.type === 'state') observe(client, message);
      if (message.type === 'error') report.errors.push(message.code || message.text);
    });
    await waitFor(`client ${index + 1} joins`, () => client.id && client.state);
  }
  await waitFor('five synchronized clients', () => clients.every(c => c.state?.players.length === 5 && enemy(c)));
  report.characterVariants = [...new Set(clients[0].state.players.map(p => `${p.species}/${p.gender}`))];
  assert.deepEqual(report.characterVariants.slice().sort(), humanProfiles.map(profile => `${profile.species}/${profile.gender}`).sort());
  const overflow = new WebSocket(`${url}?room=CROW-NETWORK-QA&name=Crow-overflow`);
  overflow.on('error', e => report.errors.push(e.message));
  overflow.on('message', bytes => {
    const message = JSON.parse(bytes.toString());
    if (message.code === 'ROOM_FULL') report.sixthClientRefused = true;
  });
  await waitFor('sixth client refusal', () => report.sixthClientRefused); overflow.close();
  const fighter = clients[0];
  const airHealth = enemy(fighter).health;
  send(fighter, { type: 'action', action: 'attack' });
  await waitFor('air swing', () => me(fighter).attackSequence === 1);
  await waitFor('air swing replicated to all five', () => clients.every(client => client.state.players.find(player => player.id === fighter.id)?.attackSequence === 1));
  await delay(450);
  assert.equal(enemy(fighter).health, airHealth);
  report.airSwing = { attackSequence: me(fighter).attackSequence, enemyHealthUnchanged: true };
  const origin = { x: enemy(fighter).x, z: enemy(fighter).z };
  send(fighter, { type: 'target', x: origin.x, z: origin.z + 4, running: true });
  console.log('Five clients joined; navigating to the crow clearing.');
  await waitFor('crow aggro', () => enemy(fighter).targetId === fighter.id || enemy(fighter).clip === 'Attack', 45000);
  await waitFor('staff damage', () => me(fighter).hurtSequence > 0, 15000);
  report.staffDamage = { energy: me(fighter).energy, hurtSequence: me(fighter).hurtSequence, enemyAttackSequence: enemy(fighter).attackSequence };
  console.log('Crow chase and staff damage observed; counterattacking with the spear.');
  for (let hit = 0; hit < 3; hit++) {
    await waitFor('within spear reach', () => withinSpearReach(me(fighter), enemy(fighter)), 12000);
    const oldHealth = enemy(fighter).health;
    const oldSequence = me(fighter).attackSequence;
    // The first strike is an aimed click; follow-up F swings use current facing.
    const payload = { type: 'action', action: 'attack' };
    if (hit === 0 || !inAttackArc(me(fighter), enemy(fighter))) payload.targetId = enemy(fighter).id;
    send(fighter, payload);
    await waitFor('spear hit', () => enemy(fighter).health === oldHealth - 25, 3500);
    assert.equal(me(fighter).attackSequence, oldSequence + 1);
    const currentHealth = enemy(fighter).health;
    await waitFor('damage replicated to all five', () => clients.every(c => enemy(c).health === currentHealth));
    await delay(550);
  }
  assert.equal(enemy(fighter).phase, 'dead');
  report.defeated = { health: enemy(fighter).health, phase: enemy(fighter).phase, clip: enemy(fighter).clip, phaseStartedAt: enemy(fighter).phaseStartedAt };
  send(fighter, { type: 'target', x: 50, z: 55, running: true });
  await waitFor('corpse hidden', () => enemy(fighter).phase === 'respawning');
  const hiddenAt = enemy(fighter).phaseStartedAt;
  report.deathDurationObservedMs = hiddenAt - report.defeated.phaseStartedAt;
  assert.ok(report.deathDurationObservedMs >= ENEMY_RULES.deathDurationMs, 'Death must finish before the corpse is hidden');
  console.log('Three spear hits defeated the crow. Waiting for the normal respawn timer.');
  await waitFor('crow respawn', () => enemy(fighter).phase === 'alive' && enemy(fighter).health === 75, 52000);
  await waitFor('respawn replicated to all five', () => clients.every(c => enemy(c).phase === 'alive' && enemy(c).health === 75));
  report.respawn = { health: 75, phase: 'alive', sharedBy: clients.length, phaseStartedAt: enemy(fighter).phaseStartedAt, hiddenAt };
  report.respawnDelayObservedMs = report.respawn.phaseStartedAt - hiddenAt;
  assert.ok(report.respawnDelayObservedMs >= ENEMY_RULES.respawnMs, 'Respawn must wait for the normal server timer');
  report.statesPerClient = clients.map(c => c.states);
  assert.equal(report.maxPlayers, 5);
  for (const clip of ['Idle_Loop','Walk_Loop','Run_Loop','Attack','Hit','Death']) assert.ok(report.clips.includes(clip), `Missing observed server clip ${clip}`);
  assert.equal(report.staticPenetrations, 0);
  assert.equal(report.dynamicPenetrations, 0);
  assert.deepEqual(report.errors, []);
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.errors.push(error.stack); process.exitCode = 1;
} finally {
  for (const client of clients) client.socket.terminate();
  await game.close();
  report.finishedAt = new Date().toISOString();
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.status, output, errors: report.errors }));
}
