import { WebSocket } from 'ws';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { CollisionWorld, overlap } from '../dist/shared/collision.mjs';
import { HUNTING_GROUNDS } from '../dist/shared/scenery-layout.mjs';
import { animalIsSolid } from '../dist/shared/hunting.mjs';
import { CHARACTER_MODELS } from '../dist/shared/characters.mjs';

const url = process.argv[2] || 'ws://127.0.0.1:3003/ws';
const roomName = process.argv[3] || 'HUNT-QA';
const output = resolve(process.argv[4] || 'assets/hunting-network-qa.json');
const sockets = [], timers = [], bots = [], resourceAmounts = new Map();
const collision = new CollisionWorld(undefined, { active: obstacle => !obstacle.resourceId || (resourceAmounts.get(obstacle.resourceId) ?? 1) > 0 });
const report = {
  startedAt: new Date().toISOString(), server: url, room: roomName, observerOnly: true,
  botActions: ['target', 'move'], states: 0, maxPlayers: 0, characters: [], phases: {}, animalHealthValues: {},
  attackSequenceIncrements: 0, attackSequencesMax: {}, cookingObserved: false,
  rawMeatPickedUp: 0, rawMeatCooked: 0, cookedMeatCreated: 0, cookedMeatEaten: 0,
  staticPenetrations: 0, dynamicPenetrations: 0, penetrationExamples: [],
  fullSnapshotBytes: [], movementSnapshotBytes: [], sixthClientRefused: false,
  bots: [], changes: [], errors: [],
};
const previousPlayers = new Map(), previousAnimals = new Map();
let latest = null, stopping = false, overflowStarted = false, announcedFive = false, writeQueue = Promise.resolve();
const send = (socket, message) => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message)); };
function persist() {
  const body = JSON.stringify(report, null, 2) + '\n';
  writeQueue = writeQueue.then(() => writeFile(output, body)).catch(error => console.error(`QA report write failed: ${error.message}`));
  return writeQueue;
}
function change(kind, serverTime, fields) { report.changes.push({ kind, serverTime, ...fields }); }
function observe(state, bytes) {
  latest = state;
  if (state.resources) for (const resource of state.resources) resourceAmounts.set(resource.id, resource.amount);
  report.states++; report.maxPlayers = Math.max(report.maxPlayers, state.players.length);
  report.characters = [...new Set([...report.characters, ...state.players.map(player => `${player.species}/${player.gender}`)])].sort();
  const sizes = state.resources ? report.fullSnapshotBytes : report.movementSnapshotBytes;
  if (sizes.length < 30) sizes.push(bytes);
  for (const animal of state.animals) {
    report.phases[animal.id] = [...new Set([...(report.phases[animal.id] || []), animal.phase])];
    report.animalHealthValues[animal.id] = [...new Set([...(report.animalHealthValues[animal.id] || []), animal.health])];
    const previous = previousAnimals.get(animal.id);
    if (!previous || previous.phase !== animal.phase || previous.health !== animal.health || previous.meatRemaining !== animal.meatRemaining) {
      change('animal', state.serverTime, { id: animal.id, x: animal.x, z: animal.z, phase: animal.phase, health: animal.health, meatRemaining: animal.meatRemaining, phaseStartedAt: animal.phaseStartedAt });
    }
    previousAnimals.set(animal.id, animal);
  }
  for (const player of state.players) {
    const previous = previousPlayers.get(player.id);
    report.attackSequencesMax[player.id] = Math.max(report.attackSequencesMax[player.id] || 0, player.attackSequence);
    report.cookingObserved ||= player.cookingEndsAt > state.serverTime;
    if (previous) {
      const attacks = player.attackSequence - previous.attackSequence;
      const raw = player.inventory.rawMeat - previous.inventory.rawMeat;
      const cooked = player.inventory.cookedMeat - previous.inventory.cookedMeat;
      const energy = player.energy - previous.energy;
      report.attackSequenceIncrements += Math.max(0, attacks);
      report.rawMeatPickedUp += Math.max(0, raw);
      if (raw < 0 && cooked > 0) report.rawMeatCooked += -raw;
      report.cookedMeatCreated += Math.max(0, cooked);
      if (cooked < 0 && energy > 0) report.cookedMeatEaten += -cooked;
      if (attacks || raw || cooked || energy || previous.cookingEndsAt !== player.cookingEndsAt) {
        change('player', state.serverTime, { id: player.id, name: player.name, attackSequence: player.attackSequence, attackAt: player.attackAt, cookingEndsAt: player.cookingEndsAt, rawMeat: player.inventory.rawMeat, cookedMeat: player.inventory.cookedMeat, energy: player.energy, delta: { attacks, rawMeat: raw, cookedMeat: cooked, energy } });
      }
    }
    previousPlayers.set(player.id, player);
  }
  const actors = [...state.players, ...state.animals.filter(animalIsSolid)];
  for (const actor of actors) if (!collision.free(actor, actor.radius)) {
    report.staticPenetrations++;
    if (report.penetrationExamples.length < 10) report.penetrationExamples.push({ kind: 'static', serverTime: state.serverTime, id: actor.id, x: actor.x, z: actor.z });
  }
  for (let a = 0; a < actors.length; a++) for (let b = a + 1; b < actors.length; b++) {
    if (!overlap(actors[a], actors[a].radius, { ...actors[b], type: 'circle' })) continue;
    report.dynamicPenetrations++;
    if (report.penetrationExamples.length < 10) report.penetrationExamples.push({ kind: 'dynamic', serverTime: state.serverTime, ids: [actors[a].id, actors[b].id] });
  }
  if (state.players.length === 5 && !announcedFive) { announcedFive = true; console.log('Five clients synchronized; all four appearance variants and hunting observations are being recorded.'); }
  if (state.players.length === 5 && !overflowStarted) {
    overflowStarted = true;
    const extra = new WebSocket(`${url}?${new URLSearchParams({ room: roomName, name: 'Hunt-QA-overflow' })}`); sockets.push(extra);
    extra.on('error', error => report.errors.push({ context: 'overflow', message: error.message }));
    extra.on('message', data => {
      const message = JSON.parse(data.toString());
      if (message.code === 'ROOM_FULL') { report.sixthClientRefused = true; console.log('Sixth client refused with ROOM_FULL.'); }
      else if (message.type === 'welcome') report.errors.push({ context: 'overflow', message: 'Sixth client unexpectedly joined.' });
      extra.close();
    });
    timers.push(setTimeout(() => extra.close(), 4000));
  }
  if (report.states % 50 === 0) void persist();
}

function moveBots() {
  if (!latest || stopping) return;
  for (const [index, bot] of bots.entries()) {
    const actor = latest.players.find(player => player.id === bot.id); if (!actor || bot.arrived) continue;
    if (!bot.goal) {
      const ground = HUNTING_GROUNDS[0], angle = .4 + index * .4;
      const point = { x: ground.x + Math.sin(angle) * 8.5, z: ground.z + Math.cos(angle) * 8.5 };
      const occupied = [...latest.players.filter(player => player.id !== bot.id), ...latest.animals.filter(animalIsSolid), ...bots.filter(other => other !== bot && other.goal).map(other => ({ ...other.goal, radius: .6 }))].map(other => ({ ...other, type: 'circle' }));
      bot.goal = collision.nearestFree(point, actor.radius, occupied, 4);
      if (!bot.goal) { report.errors.push({ context: 'navigation', message: `No free peripheral destination for ${bot.name}` }); continue; }
      report.bots[index].goal = bot.goal;
    }
    const remaining = Math.hypot(actor.x - bot.goal.x, actor.z - bot.goal.z);
    if (remaining < .15) {
      send(bot.socket, { type: 'move', dx: 0, dz: 0, running: false }); bot.arrived = true;
      report.bots[index].arrivedAt = latest.serverTime; report.bots[index].position = { x: actor.x, z: actor.z };
      console.log(`${bot.name} arrived at the clearing perimeter.`); continue;
    }
    // Replan only when stalled. These clients never issue combat or inventory actions.
    if (!bot.lastTargetAt || (!actor.moving && Date.now() - bot.lastTargetAt > 3000)) {
      send(bot.socket, { type: 'target', ...bot.goal, running: true }); bot.lastTargetAt = Date.now();
    }
  }
}

async function stop(reason = 'requested') {
  if (stopping) return; stopping = true;
  for (const timer of timers) clearTimeout(timer);
  report.finishedAt = new Date().toISOString(); report.endReason = reason;
  report.workflowObserved = report.attackSequenceIncrements >= 4 && Object.values(report.phases).some(phases => phases.includes('dying') && phases.includes('meat')) && report.rawMeatPickedUp > 0 && report.cookingObserved && report.cookedMeatCreated > 0 && report.cookedMeatEaten > 0;
  await persist();
  for (const socket of sockets) socket.close();
  await Promise.race([Promise.all(sockets.map(socket => socket.readyState === WebSocket.CLOSED ? Promise.resolve() : new Promise(resolveClose => socket.once('close', resolveClose)))), new Promise(resolveClose => setTimeout(resolveClose, 1500))]);
  for (const socket of sockets) if (socket.readyState !== WebSocket.CLOSED) socket.terminate();
  console.log(`Hunting QA saved: ${output}; workflowObserved=${report.workflowObserved}`); process.exit(0);
}
process.stdin.setEncoding('utf8'); process.stdin.on('data', input => { if (input.trim().toLowerCase() === 'q') void stop('stdin q'); }); process.stdin.resume();
process.on('SIGINT', () => void stop('SIGINT')); process.on('SIGTERM', () => void stop('SIGTERM'));
for (const [index, profile] of CHARACTER_MODELS.filter(p => p.species === 'cro' || p.species === 'nea').entries()) {
  const name = `Hunt-QA-${index + 1}`, socket = new WebSocket(`${url}?${new URLSearchParams({ room: roomName, name, species: profile.species, gender: profile.gender })}`);
  const bot = { socket, name, id: null, goal: null, arrived: false, lastTargetAt: 0 };
  bots.push(bot); sockets.push(socket); report.bots.push({ name, species: profile.species, gender: profile.gender });
  socket.on('error', error => { report.errors.push({ context: name, message: error.message }); console.error(`${name}: ${error.message}`); });
  socket.on('message', data => {
    const message = JSON.parse(data.toString());
    if (message.type === 'welcome') { bot.id = message.id; report.bots[index].id = bot.id; }
    if (message.type === 'error') report.errors.push({ context: name, ...message });
    if (index === 0 && message.type === 'state') observe(message, data.length);
  });
}
timers.push(setInterval(moveBots, 500)); timers.push(setTimeout(() => void stop('12 minute limit'), 12 * 60 * 1000));
console.log(`Four observer bots for ${roomName}, PID ${process.pid}. They will sprint to the first clearing perimeter and idle; send q to save and close them.`);
