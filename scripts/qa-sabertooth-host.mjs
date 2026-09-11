// Parent-only fixture host for the sabertooth browser QA: never imported by the normal server.
import { readFile } from 'node:fs/promises';
if (!process.connected) throw Error('QA host requires parent IPC');
const { createGameServer } = await import('../dist/server.mjs');
const { createSabertooth } = await import('../dist/shared/sabertooth.mjs');
const { SABERTOOTH: R } = await import('../dist/shared/sabertooth-rules.mjs');
const { stopActor } = await import('../dist/shared/combat.mjs');
const ROOM = 'CAT-QA',
  far = 1e15;
const game = createGameServer({ port: 0, host: '127.0.0.1' });
const normal = game.server.listeners('request')[0];
game.server.removeListener('request', normal);
game.server.on('request', async (req, res) => {
  if (req.url.split('?')[0] === '/') {
    const html = await readFile('public/index.html', 'utf8');
    res
      .writeHead(200, { 'Content-Type': 'text/html' })
      .end(
        html.replace(
          '<script type="module" src="/src/main.js"></script>',
          '<script type="module">import {WorldRenderer} from "/src/world3d.js";const old=WorldRenderer.prototype.render;WorldRenderer.prototype.render=function(...a){window.monsterReview=this;return old.apply(this,a)};await import("/src/main.js");</script>',
        ),
      );
  } else normal(req, res);
});
const { port } = await game.listen();
const project = () => {
  const room = game.rooms.get(ROOM);
  if (!room) return null;
  const e = room.enemies.find((e) => e.modelKey === R.modelKey);
  return {
    enemy: { ...e, pendingAttack: e.pendingAttack },
    players: [...room.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      x: p.x,
      z: p.z,
      energy: p.energy,
      hurtSequence: p.hurtSequence,
      pendingStrike: p.pendingStrike,
    })),
    count: room.players.size,
  };
};
process.send({ ready: true, port });
process.on('message', async (m) => {
  try {
    const room = game.rooms.get(ROOM);
    if (m.kind === 'prepare') {
      const e = room.enemies.find((e) => e.modelKey === R.modelKey),
        now = Date.now();
      Object.assign(e, createSabertooth(room.collision, [], now));
      e.facing = 0;
      e.nextRoamAt = far;
      const people = [...room.players.values()];
      for (const [i, p] of people.entries()) {
        stopActor(p);
        p.energy = 100;
        p.downedUntil = 0;
        p.hurtSequence = 0;
        p.pendingStrike = null;
        p.invulnerableUntil = i ? now + 600000 : 0;
        Object.assign(p, { x: e.x + 9 + i * 2, z: e.z + 9, facing: Math.PI });
      }
      const p = people.find((p) => p.name === 'Monster A');
      if (!p) throw Error('Missing Monster A');
      if (m.mode === 'guard') {
        Object.assign(p, { x: e.x, z: e.z + 12 });
        e.aggroAfter = now + 600000;
      } else if (m.mode === 'rear') Object.assign(p, { x: e.x, z: e.z - 12 });
      else if (m.mode === 'hunt') Object.assign(p, { x: e.x, z: e.z + 14 });
      else if (m.mode === 'pounce') {
        Object.assign(p, { x: e.x, z: e.z + 7 });
        e.targetId = p.id;
        e.aggroAfter = now;
      } else if (m.mode === 'claw') {
        Object.assign(p, { x: e.x, z: e.z + e.radius + p.radius + 0.3 });
        e.targetId = p.id;
        e.aggroAfter = now;
      } else if (m.mode === 'step') {
        // Adjacent, facing the cat; the page presses the real attack key and
        // the cat, holding its own attacks, must hop aside.
        Object.assign(p, { x: e.x, z: e.z + e.radius + p.radius + 0.9, facing: Math.PI });
        e.targetId = p.id;
        e.aggroAfter = now;
        e.nextAttackAt = far;
        e.nextPounceAt = far;
      } else if (m.mode === 'return') {
        Object.assign(e, { z: e.home.z + 12, targetId: p.id });
        p.z = e.home.z + R.territoryRadius + 2;
      } else if (m.mode === 'death') {
        Object.assign(p, { x: e.x, z: e.z + 8 });
        e.phase = 'dead';
        e.phaseStartedAt = now;
        e.health = 0;
        e.alive = false;
      }
    }
    if (m.kind === 'escape') {
      const e = room.enemies.find((e) => e.modelKey === R.modelKey);
      for (const p of room.players.values()) p.z = e.home.z + R.territoryRadius + 5;
    }
    if (m.kind === 'stop') {
      await game.close();
      process.send({ reply: m.id, ok: true });
      process.exit(0);
      return;
    }
    process.send({ reply: m.id, ok: true, value: project() });
  } catch (e) {
    process.send({ reply: m.id, ok: false, error: e.message });
  }
});
process.once('disconnect', () => void game.close().finally(() => process.exit()));
