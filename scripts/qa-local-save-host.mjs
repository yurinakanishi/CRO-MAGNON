// Private parent-only fixture host. Never used by the normal or exhibition executable.
if (!process.connected) throw new Error('QA host requires parent IPC');
const build = process.env.GAME_QA_BUILD || new URL('../dist/', import.meta.url).href;
const { createPersistentGameServer } = await import(build + 'server.mjs');
const game = await createPersistentGameServer({
  saveDirectory: process.env.CRO_SAVE_DIR,
  port: Number(process.env.PORT) || 0,
  host: '127.0.0.1',
});
const { port } = await game.listen();
function projection() {
  const room = game.rooms.get('SAVE-CHROME');
  if (!room) return null;
  return {
    createdAt: room.createdAt,
    camp: room.camp,
    gulf: room.gulf,
    people: [...room.players.values(), ...Array.from(room.sessions.values(), (s) => s.player)].map(
      (p) => ({
        id: p.id,
        name: p.name,
        x: p.x,
        z: p.z,
        inventory: p.inventory,
        spearHead: p.spearHead,
        gulf: p.gulf,
      }),
    ),
    residents: room.residents.map((r) => ({
      id: r.id,
      watering: r.watering,
      forage: r.forage,
      supper: r.supper,
    })),
    households: room.households,
    resource: { id: room.resources[0].id, amount: room.resources[0].amount },
  };
}
process.send({ ready: true, port, loaded: projection() });
process.on('message', async (message) => {
  try {
    if (message.kind === 'prepare') {
      const room = game.rooms.get('SAVE-CHROME');
      const people = [...room.players.values()];
      people.forEach((p, i) => {
        Object.assign(p.inventory, {
          obsidian: 4 + i,
          obsidianBlade: 2,
          cookedShellfish: 3,
          shells: 6,
          water: 2,
        });
        p.spearHead = 'obsidian';
      });
      Object.assign(room.gulf.plots[0], {
        stage: 'planted',
        cropId: 'root',
        waterRequestAt: Date.now(),
      });
      room.gulf.pantries[0].food.cookedRoot = 3;
      room.gulf.pantries[0].supper.berry = 2;
      room.gulf.middens[0].shells = 9;
      room.residents[0].watering.water = 2;
      room.resources[0].amount = 1;
    }
    if (message.kind === 'save') await game.saveNow();
    if (message.kind === 'stop') {
      await game.close();
      process.send({ reply: message.id, ok: true });
      process.exit(0);
    }
    process.send({ reply: message.id, ok: true, value: projection() });
  } catch (error) {
    process.send({ reply: message.id, ok: false, error: error.message });
  }
});
process.once('disconnect', () => void game.close().finally(() => process.exit()));
