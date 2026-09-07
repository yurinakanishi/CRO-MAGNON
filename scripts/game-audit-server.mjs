// Local QA fixtures are accepted only on stdin, never from the game protocol.
import { createInterface } from 'node:readline';
import { createGameServer } from '../server.mjs';
import { stopActor } from '../shared/combat.mjs';
import { releaseRider, ridingObstacles } from '../shared/riding.mjs';
const game = createGameServer({ port: Number(process.env.AUDIT_PORT) || 3005, host: '127.0.0.1' });
await game.listen();
console.log(JSON.stringify({ ready: true, port: game.address().port }));
const input = createInterface({ input: process.stdin });
input.on('line', line => {
  let command;
  try {
    command = JSON.parse(line);
    const room = game.rooms.get(command.room || 'AUDIT');
    if (!room) throw new Error('QA room is empty');
    const player = [...room.players.values()].find(p => p.id === command.player || p.name === command.player);
    if (command.fixture) {
      if (!player) throw new Error('Unknown QA player');
      releaseRider(room, player);
      const fixture = command.fixture;
      if (Number.isFinite(fixture.x) && Number.isFinite(fixture.z)) {
        const point = room.collision.nearestFree(fixture, player.radius, ridingObstacles(room, null, player), 8);
        if (!point) throw new Error('No safe fixture position');
        Object.assign(player, point);
      }
      for (const key of ['facing', 'energy', 'invulnerableUntil']) if (Number.isFinite(fixture[key])) player[key] = fixture[key];
      if (fixture.inventory) Object.assign(player.inventory, fixture.inventory);
      player.lastAction = 0;
    }
    if (command.disconnect && player) player.socket.terminate();
    if (command.stop && player) stopActor(player);
    console.log(JSON.stringify({ request: command.request, state: game.snapshot(room, true) }));
  } catch (error) { console.log(JSON.stringify({ request: command?.request, error: error.message })); }
});
const close = async () => { input.close(); await game.close(); process.exit(0); };
process.once('SIGINT', close); process.once('SIGTERM', close);
