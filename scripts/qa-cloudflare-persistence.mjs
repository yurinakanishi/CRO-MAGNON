import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { freshBudget } from '../cloudflare/free-budget.mjs';

const mf = new Miniflare({ ...convertV4MiniflareOptions({ name: 'game-test', modules: true,
  scriptPath: 'output/cloudflare-dry-run/worker.js', compatibilityDate: '2026-09-07',
  compatibilityFlags: ['nodejs_compat'], bindings: { SERVICE_ENABLED: 'true' },
  durableObjects: { GAME: { className: 'FreeGameRoom', useSQLite: true } } }), unsafeInspectDurableObjects: true });
const pause = ms => new Promise(r => setTimeout(r, ms));
async function open(session) {
  const response = await mf.dispatchFetch(`http://localhost/ws?${new URLSearchParams({ room: 'EMBER', name: 'Persistence QA', resume: '1', ...(session ? { session } : {}) })}`, { headers: { Upgrade: 'websocket' } });
  if (response.status !== 101) return { response };
  const socket = response.webSocket, messages = []; socket.accept();
  socket.addEventListener('message', event => messages.push(JSON.parse(event.data)));
  return { socket, messages, async wait(predicate) {
    for (let i = 0; i < 200; i++) { const match = messages.find(predicate); if (match) return match; await pause(20); }
    throw new Error('Worker response timed out');
  } };
}
try {
  let client = await open();
  const welcome = await client.wait(m => m.type === 'welcome');
  client.socket.close(); await pause(300);
  const storage = await mf.unsafeGetDurableObjectStorage('game-test', 'FreeGameRoom', { name: 'EMBER' });
  const read = async () => JSON.parse((await storage.exec('SELECT data FROM checkpoint WHERE id = 1'))[0].data);
  const seed = async data => {
    await storage.exec('UPDATE checkpoint SET data = ? WHERE id = 1', JSON.stringify(data));
    await mf.unsafeEvictDurableObject('game-test', 'FreeGameRoom', { name: 'EMBER', webSockets: 'close' });
  };
  let saved = await read();
  saved.game.rooms[0].sessions[0].player.inventory.wood = 11;
  saved.game.rooms[0].camp.wood = 8;
  await seed(saved);
  client = await open(welcome.session);
  assert.equal((await client.wait(m => m.type === 'welcome')).resumed, true);
  const state = await client.wait(m => m.type === 'state');
  assert.equal(state.players[0].inventory.wood, 11); assert.equal(state.camp.wood, 8);
  client.socket.close(); await pause(300);
  const baseline = await read();
  for (const [field, value] of [['activeMs', 12 * 3600000], ['connections', 2000], ['writes', 20000]]) {
    saved = structuredClone(baseline); saved.budget = { ...freshBudget(), [field]: value }; await seed(saved);
    const refused = await open(welcome.session); assert.equal(refused.response.status, 503, field);
    assert.equal((await read()).game.rooms[0].sessions[0].player.inventory.wood, 11);
  }
  saved = structuredClone(baseline); saved.budget = { ...freshBudget(), messages: 400000 }; await seed(saved);
  client = await open(welcome.session); await client.wait(m => m.type === 'welcome');
  client.socket.send(JSON.stringify({ type: 'move', dx: 1, dz: 0 }));
  assert.equal((await client.wait(m => m.type === 'error')).code, 'FREE_LIMIT');
  await pause(100);
  // A real SQL write failure must refuse a new session, not acknowledge a save.
  saved = structuredClone(baseline); saved.budget = freshBudget(); await seed(saved);
  await storage.exec("CREATE TRIGGER fail_save BEFORE INSERT ON checkpoint BEGIN SELECT RAISE(ABORT, 'injected storage failure'); END");
  const failed = await open(welcome.session); assert.equal(failed.response.status, 503);
  assert.equal((await read()).game.rooms[0].sessions[0].player.inventory.wood, 11);
  const result = { checkedAt: new Date().toISOString(), status: 'passed', actualSqliteRestore: true,
    inventoryAndCampRestored: true, activeTimeLimit: true, connectionLimit: true, writeLimit: true,
    messageLimit: true, storageFailureStopsPlay: true, priorCheckpointPreserved: true };
  await mkdir('assets/cloudflare', { recursive: true });
  await writeFile('assets/cloudflare/persistence-qa.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally { await mf.dispose(); }
