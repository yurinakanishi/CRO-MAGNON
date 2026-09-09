// Loopback-only, in-memory QA world. Normal saves and running servers are untouched.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { WebSocket } from 'ws';
import { createGameServer } from '../dist/server.mjs';
import { stopActor } from '../dist/shared/combat.mjs';
const game = createGameServer({ port: 3024, host: '127.0.0.1' });
const normal = game.server.listeners('request')[0];
game.server.removeListener('request', normal);
await mkdir('output/downed-motion/game', { recursive: true });
const peers = [];
const fixtures = [];
game.server.on('request', async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/') {
      const html = await readFile('public/index.html', 'utf8');
      res
        .writeHead(200, { 'Content-Type': 'text/html' })
        .end(
          html.replace(
            '<script type="module" src="/src/main.js"></script>',
            '<script type="module" src="/downed-qa.js"></script>',
          ),
        );
    } else if (url.pathname === '/downed-qa.js') {
      res
        .writeHead(200, { 'Content-Type': 'text/javascript' })
        .end(await readFile('assets/downed-motion/game-qa.js'));
    } else if (url.pathname === '/downed-hit' && req.method === 'POST') {
      if (!peers.length)
        for (const [name, species, gender] of [
          ['Peer C', 'cro', 'male'],
          ['Peer D', 'nea', 'female'],
          ['Peer E', 'cat', 'female'],
        ]) {
          const ws = new WebSocket(
            'ws://127.0.0.1:3024/ws?' +
              new URLSearchParams({ room: 'DOWNED-QA', name, species, gender }),
          );
          await new Promise((resolve, reject) => {
            ws.once('open', resolve);
            ws.once('error', reject);
          });
          peers.push(ws);
        }
      const room = game.rooms.get('DOWNED-QA'),
        now = Date.now(),
        e = room.enemies.find((e) => e.modelKey === 'crow-shaman');
      const target = url.searchParams.get('name');
      const p = [...room.players.values()].find((p) => p.name === target);
      if (!p) throw Error('Join the QA world first');
      stopActor(e);
      Object.assign(e, {
        x: e.home.x,
        z: e.home.z,
        facing: 0,
        hitUntil: 0,
        targetId: p.id,
        returning: false,
        phase: 'alive',
        health: 75,
        aggroAfter: 0,
      });
      let i = 0;
      for (const other of room.players.values()) {
        stopActor(other);
        other.invulnerableUntil = now + 60000;
        const point = room.collision.nearestFree(
          { x: e.x + 3 + i++ * 2, z: e.z + 3 },
          other.radius,
          [],
          8,
        );
        Object.assign(other, point);
      }
      Object.assign(p, {
        x: e.x,
        z: e.z + e.radius + p.radius + 0.2,
        facing: Math.PI,
        energy: 10,
        invulnerableUntil: 0,
        downedUntil: 0,
      });
      e.attackSequence++;
      e.attackAt = now;
      e.attackLockUntil = now + 1000;
      e.pendingAttack = { targetId: p.id, facing: 0, impactAt: now + 550 };
      fixtures.push({
        name: p.name,
        at: now,
        kind: 'Initial proximity, energy 10, pending enemy strike; damage/recovery use real server ticks',
        players: room.players.size,
      });
      res.writeHead(200).end('致命傷の攻撃を準備しました');
    } else if (/^\/downed-report\/(A|B)$/.test(url.pathname) && req.method === 'POST') {
      const chunks = [];
      let size = 0;
      for await (const c of req) {
        size += c.length;
        if (size > 4e6) throw Error('too large');
        chunks.push(c);
      }
      const report = JSON.parse(Buffer.concat(chunks));
      await writeFile(
        `output/downed-motion/game/${url.pathname.endsWith('A') ? 'A' : 'B'}.json`,
        JSON.stringify({ ...report, fixtures }, null, 2),
      );
      res.writeHead(200).end('検査記録を保存しました');
    } else normal(req, res);
  } catch (e) {
    res.writeHead(400).end(String(e));
  }
});
await game.listen();
console.log('QA http://127.0.0.1:3024/?room=DOWNED-QA&slot=A (B uses ape)');
