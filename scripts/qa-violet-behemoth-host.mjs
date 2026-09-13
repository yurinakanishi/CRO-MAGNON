// Parent-only fixture host: never imported by the normal server.
import { readFile } from 'node:fs/promises';
if (!process.connected) throw Error('QA host requires parent IPC');
const { createGameServer } = await import('../dist/server.mjs');
const { createBehemoth } = await import('../dist/shared/violet-behemoth.mjs');
const { BEHEMOTH: R } = await import('../dist/shared/behemoth-rules.mjs');
const { stopActor } = await import('../dist/shared/combat.mjs');
const game = createGameServer({ port: 0, host: '127.0.0.1' });
const normal = game.server.listeners('request')[0];
game.server.removeListener('request', normal);
game.server.on('request', async (req, res) => {
  if (req.url.split('?')[0] === '/') {
    const html = await readFile('public/index.html', 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html' }).end(
      html.replace(
        '<script type="module" src="/src/main.js"></script>',
        `<script type="module">
          import {WorldRenderer} from "/src/world3d.js";
          import {PoisonEffects} from "/src/poison-effects.js";
          const old=WorldRenderer.prototype.render;
          WorldRenderer.prototype.render=function(...a){window.monsterReview=this;return old.apply(this,a)};
          const update=PoisonEffects.prototype.update;
          window.poisonReviewFrames=[];
          PoisonEffects.prototype.update=function(state,now,...rest){
            update.call(this,state,now,...rest);
            if(state.poisonShots?.length || state.poisonSplashes?.length){
              window.poisonReviewFrames.push({at:now,shots:state.poisonShots?.length??0,splashes:state.poisonSplashes?.length??0,particles:this.count});
              if(window.poisonReviewFrames.length>1200)window.poisonReviewFrames.shift();
            }
          };
          await import("/src/main.js");
          </script>`,
      ),
    );
  } else normal(req, res);
});
const { port } = await game.listen();
const project = () => {
  const room = game.rooms.get('BEHEMOTH-QA');
  if (!room) return null;
  const e = room.enemies.find((e) => e.modelKey === R.modelKey);
  return {
    enemy: { ...e, pendingAttack: e.pendingAttack },
    poisonShots: room.poisonShots ?? [],
    poisonSplashes: room.poisonSplashes ?? [],
    players: [...room.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      x: p.x,
      z: p.z,
      energy: p.energy,
      hurtSequence: p.hurtSequence,
      inventory: p.inventory,
    })),
    count: room.players.size,
  };
};
process.send({ ready: true, port, tuning: R });
process.on('message', async (m) => {
  try {
    const room = game.rooms.get('BEHEMOTH-QA');
    if (m.kind === 'prepare') {
      const e = room.enemies.find((e) => e.modelKey === R.modelKey),
        now = Date.now();
      Object.assign(e, createBehemoth(room.collision, [], now));
      room.poisonShots = [];
      room.poisonSplashes = [];
      e.facing = 0;
      // Fixed poses isolate colour/attack checks; the patrol fixture below runs
      // the ordinary idle AI with every character outside its territory.
      if (['guard', 'rear'].includes(m.mode)) e.patrolPauseUntil = now + 600000;
      const people = [...room.players.values()];
      for (const [i, p] of people.entries()) {
        stopActor(p);
        p.energy = 100;
        p.downedUntil = 0;
        p.hurtSequence = 0;
        p.invulnerableUntil = i ? now + 600000 : 0;
        Object.assign(p, { x: e.x + 9 + i * 2, z: e.z + 9, facing: Math.PI });
      }
      const p = people.find((p) => p.name === 'Monster A');
      if (!p) throw Error('Missing Monster A');
      if (m.mode === 'rear') Object.assign(p, { x: e.x, z: e.z - 9 });
      else if (m.mode === 'poison') {
        Object.assign(p, { x: e.x, z: e.z + 18 });
        e.targetId = p.id;
        e.aggroAfter = now;
      } else if (['bite', 'tail'].includes(m.mode)) {
        Object.assign(p, { x: e.x, z: e.z + e.radius + p.radius + 0.1 });
        e.targetId = p.id;
        e.aggroAfter = now;
        e.meleeIndex = m.mode === 'tail' ? 1 : 0;
      } else Object.assign(p, { x: e.x, z: e.z + 12 });
      if (m.mode === 'guard') {
        e.aggroAfter = now + 600000;
      }
      if (m.mode === 'patrol') {
        for (const [i, person] of people.entries())
          Object.assign(person, { x: e.home.x + (i === 1 ? -26 : 26 + i * 3), z: e.home.z + 26 });
      }
      if (m.mode === 'return') {
        Object.assign(e, { z: e.home.z + 12, targetId: p.id });
        p.z = e.home.z + R.territoryRadius + 2;
      }
      if (m.mode === 'death') {
        e.phase = 'dead';
        e.phaseStartedAt = now;
        e.health = 0;
        e.alive = false;
      }
    }
    if (m.kind === 'place') {
      // Marsh QA: stand the reviewer exactly where the sheet and floor must agree.
      const p = [...room.players.values()].find((p) => p.name === (m.player ?? 'Monster A'));
      if (!p) throw Error('Missing Monster A');
      stopActor(p);
      Object.assign(p, { x: m.x, z: m.z });
      if (Number.isFinite(m.facing)) p.facing = m.facing;
      if (m.vulnerable) p.invulnerableUntil = 0;
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
