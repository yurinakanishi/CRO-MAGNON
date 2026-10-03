// CUA-operated real game fixture. Isolated memory-only room, no user save files.
import { createGameServer } from '../dist/server.mjs';
import { CAVE_HEARTH, caveWorldAt } from '../dist/shared/camp-cave-layout.mjs';
import { WebSocket } from 'ws';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const folder = 'output/cave-rimo-r30';
await mkdir(folder, { recursive: true });
const game = createGameServer({ port: 0, host: '127.0.0.1' });
const original = game.server.listeners('request');
game.server.removeAllListeners('request');
const appended = await readFile('assets/camp-cave/workflow/game-review-r30.js', 'utf8');
const samples = [];
const peers = [];
const prepared = new Set();
game.server.on('request', async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/src/world3d.js') {
      const code = await readFile('dist/src/world3d.js', 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' });
      res.end(code + '\n' + appended);
      return;
    }
    if (url.pathname === '/qa-r30/capture' && req.method === 'POST') {
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 12 * 1024 * 1024) throw Error('Capture too large');
        chunks.push(chunk);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString());
      if (!['east', 'east-close', 'west', 'both', 'normal'].includes(body.view))
        throw Error('Invalid view');
      const png = Buffer.from(body.image.split(',')[1], 'base64');
      if (png.readUInt32BE(0) !== 0x89504e47) throw Error('Invalid PNG');
      const filename = `${Date.now()}-${body.view}-${body.fire ? 'lit' : 'unlit'}.png`;
      await writeFile(`${folder}/${filename}`, png);
      delete body.image;
      const record = {
        ...body,
        file: `${folder}/${filename}`,
        sha256: createHash('sha256').update(png).digest('hex'),
        peers: peers.map((p) => ({ name: p.name, fire: p.fire, players: p.players })),
      };
      samples.push(record);
      await writeFile(`${folder}/captures.json`, JSON.stringify(samples, null, 2) + '\n');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ saved: filename }));
      return;
    }
    if (url.pathname === '/qa-r30/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          samples,
          peers: peers.map((p) => ({ name: p.name, fire: p.fire, players: p.players })),
        }),
      );
      return;
    }
    for (const listener of original) await listener(req, res);
  } catch (error) {
    res.writeHead(500);
    res.end(String(error));
  }
});
const { port } = await game.listen();
for (let i = 0; i < 3; i++) {
  const peer = { name: `MuralPeer${i}`, fire: null, players: 0 };
  peers.push(peer);
  peer.ws = new WebSocket(`ws://127.0.0.1:${port}/ws?room=MURAL-R30&name=${peer.name}`);
  peer.ws.on('message', (data) => {
    const m = JSON.parse(String(data));
    const s = m.state ?? m;
    if (s.camp) {
      peer.fire = s.camp.caveFireLit;
      peer.players = s.players?.length ?? 0;
    }
  });
}
const timer = setInterval(() => {
  const room = game.rooms.get('MURAL-R30');
  if (!room) return;
  room.enemies = [];
  if (!prepared.has('room')) {
    room.camp.caveFireLit = true;
    prepared.add('room');
  }
  for (const player of room.players.values())
    if (!prepared.has(player.id)) {
      // Explicit initial scene fixture, not evidence of walking from the camp.
      Object.assign(
        player,
        player.name.startsWith('MuralPeer') ? caveWorldAt(-16, 2) : caveWorldAt(-21.2, 1),
      );
      player.move = { dx: 0, dz: 0 };
      prepared.add(player.id);
    }
}, 100);
console.log(`CAVE_R30_GAME http://127.0.0.1:${port}/?room=MURAL-R30`);
console.log(
  'Scene fixture: two real browser players + three protocol peers; cave starts lit. Use E near the hearth to toggle it.',
);
process.once('SIGINT', async () => {
  clearInterval(timer);
  for (const p of peers) p.ws.close();
  await game.close();
  process.exit(0);
});
