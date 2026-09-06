import { WebSocket } from 'ws';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { CHARACTER_MODELS } from '../shared/characters.mjs';

// Four passive peers for a fifth human-driven browser. They navigate once to
// the clearing perimeter and never issue attacks or inventory actions.
const url = process.argv[2] || 'ws://127.0.0.1:3000/ws';
const room = process.argv[3] || 'CROW-BROWSER-QA';
const output = resolve(process.argv[4] || 'assets/crow-browser-network-qa.json');
const report = { startedAt: new Date().toISOString(), room, url, role: 'four-passive-observers', maxPlayers: 0, states: 0, phases: [], health: [], clips: [], playerHurt: false, playerDefeat: false, errors: [] };
const goals = [[42, 26], [44, 28], [46, 28], [48, 26]];
const clients = [], timers = [];
let stopping = false;
async function stop(reason) {
  if (stopping) return; stopping = true;
  timers.forEach(clearTimeout);
  for (const client of clients) client.socket.terminate();
  report.finishedAt = new Date().toISOString(); report.endReason = reason;
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ output, maxPlayers: report.maxPlayers, errors: report.errors }));
  process.exit(report.errors.length ? 1 : 0);
}
for (const [index, profile] of CHARACTER_MODELS.filter(p => p.species === 'cro' || p.species === 'nea').entries()) {
  const socket = new WebSocket(`${url}?${new URLSearchParams({ room, name: `Crow-observer-${index + 1}`, species: profile.species, gender: profile.gender })}`);
  const client = { socket, id: null, moved: false }; clients.push(client);
  socket.on('error', e => report.errors.push(e.message));
  socket.on('message', bytes => {
    const message = JSON.parse(bytes.toString());
    if (message.type === 'welcome') client.id = message.id;
    if (message.type === 'error') report.errors.push(message.code || message.text);
    if (message.type !== 'state') return;
    const self = message.players.find(p => p.id === client.id);
    if (self && !client.moved) {
      client.moved = true;
      socket.send(JSON.stringify({ type: 'target', x: goals[index][0], z: goals[index][1], running: true }));
    }
    if (index !== 0) return;
    report.states++; report.maxPlayers = Math.max(report.maxPlayers, message.players.length);
    report.lastPlayers = message.players.map(p => ({ name: p.name, species: p.species, gender: p.gender, x: p.x, z: p.z, energy: p.energy, attackSequence: p.attackSequence, hurtSequence: p.hurtSequence, downedUntil: p.downedUntil, inventory: p.inventory }));
    report.playerHurt ||= message.players.some(p => p.hurtSequence > 0);
    report.playerDefeat ||= message.players.some(p => p.defeatSequence > 0);
    for (const e of message.enemies || []) for (const [key, value] of [['phases', e.phase], ['health', e.health], ['clips', e.clip]]) if (!report[key].includes(value)) report[key].push(value);
    if (report.states === 40) console.log('Four passive peers connected and moving to the clearing perimeter.');
  });
}
process.stdin.setEncoding('utf8'); process.stdin.on('data', text => { if (text.trim().toLowerCase() === 'q') void stop('stdin q'); }); process.stdin.resume();
process.once('SIGINT', () => void stop('SIGINT')); process.once('SIGTERM', () => void stop('SIGTERM'));
timers.push(setTimeout(() => void stop('12 minute limit'), 720000));
console.log(`Crow observers ready for ${room}; send q to save and stop.`);
