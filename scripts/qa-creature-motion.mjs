// Loopback-only QA server. Browser interaction is performed through CUA.
// Explicit fixtures: profiles, three socket peers and an optional near-mammoth position.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { WebSocket } from 'ws';
const build = new URL('../output/creature-motion/preview/dist/', import.meta.url);
const { createGameServer } = await import(new URL('server.mjs', build));
const { stopActor } = await import(new URL('shared/combat.mjs', build));
const game = createGameServer({ port: 3017, host: '127.0.0.1' });
const original = game.server.listeners('request')[0];
game.server.removeListener('request', original);
const out = 'output/playwright/creature-motion-20260909/game';
await mkdir(out, { recursive: true });
const fixtures = [];
game.server.on('request', async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/') {
      const html = await readFile(new URL('../public/index.html', build), 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
      res.end(
        html.replace(
          '<script type="module" src="/src/main.js"></script>',
          '<script type="module" src="/motion-qa.js"></script>',
        ),
      );
    } else if (url.pathname === '/motion-qa.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript' });
      res.end(await readFile('assets/creature-motion/game-qa.js'));
    } else if (req.method === 'POST' && url.pathname === '/motion-fixture') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const { name } = JSON.parse(body),
        room = game.rooms.get('MOTION-QA');
      const p = [...room.players.values()].find((p) => p.name === name);
      if (!p || !['Motion A', 'Motion B'].includes(name)) throw Error('QA player not found');
      const a = room.animals[0];
      stopActor(a);
      stopActor(p);
      Object.assign(a, { nextRoam: Infinity, age: 0, hitUntil: 0 });
      Object.assign(p, { x: a.x, z: a.z + a.radius + p.radius + 0.65 });
      fixtures.push({ at: Date.now(), name, nearMammoth: a.id, x: p.x, z: p.z });
      res.writeHead(200).end('near-mammoth fixture prepared');
    } else if (req.method === 'POST' && /^\/motion-report\/(a|b)\.json$/.test(url.pathname)) {
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 10e6) throw Error('too large');
        chunks.push(chunk);
      }
      const report = JSON.parse(Buffer.concat(chunks));
      await writeFile(
        `${out}/${url.pathname.endsWith('a.json') ? 'a' : 'b'}.json`,
        JSON.stringify({ ...report, fixtures }, null, 2),
      );
      res.writeHead(200).end('saved');
    } else original(req, res);
  } catch (error) {
    res.writeHead(400).end(String(error));
  }
});
await game.listen();
const peers = [];
for (const [name, species, gender] of [
  ['Motion C', 'cro', 'male'],
  ['Motion D', 'nea', 'female'],
  ['Motion E', 'nea', 'male'],
]) {
  const socket = new WebSocket(
    'ws://127.0.0.1:3017/ws?' + new URLSearchParams({ room: 'MOTION-QA', name, species, gender }),
  );
  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  peers.push(socket);
}
console.log('Motion QA http://127.0.0.1:3017/?room=MOTION-QA&qa=a PID ' + process.pid);
process.once('SIGINT', async () => {
  for (const s of peers) s.close();
  await game.close();
  process.exit(0);
});
