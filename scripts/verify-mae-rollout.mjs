// Read/backup verification only. Never write a checkpoint back into the save directory.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, cp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createGameCore } from '../dist/application/game-core.mjs';
const base = 'output/mae-server-20261003';
const hash = (b) => createHash('sha256').update(b).digest('hex');
async function state(path) {
  const raw = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(raw.sha256, hash(JSON.stringify({ revision: raw.revision, state: raw.state })));
  return raw.state;
}
const projection = (s) =>
  s.rooms
    .map((r) => ({
      name: r.name,
      sessions: r.sessions
        .map((e) => {
          const p = e.player;
          return Object.fromEntries(
            Object.entries(p).filter(
              ([key]) =>
                ![
                  'socket',
                  'lastInput',
                  'lastAction',
                  'lastHitAt',
                  'move',
                  'path',
                  'moving',
                  'running',
                  'turning',
                  'sessionToken',
                  'returning',
                  'pendingStrike',
                  'nextPathAt',
                ].includes(key),
            ),
          );
        })
        .sort((a, b) => a.id.localeCompare(b.id)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
if (process.argv[2] === 'prepare') {
  await mkdir(base, { recursive: true });
  await cp('.cro-magnon-save', base + '/before', {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
  const saved = await state(base + '/before/world.json');
  assert.equal(
    hash(await readFile('.cro-magnon-save/world.json')),
    hash(await readFile(base + '/before/world.json')),
  );
  const core = createGameCore({ keepEmptyRooms: true, persistentSessions: true });
  core.importState(saved);
  const restored = core.exportState();
  await writeFile(base + '/expected-private.json', JSON.stringify(projection(restored)));
  const summary = {
    sourceSaveSha256: hash(await readFile(base + '/before/world.json')),
    rooms: saved.rooms.length,
    sessions: saved.rooms.reduce((n, r) => n + r.sessions.length, 0),
    newMae: restored.rooms.every((r) => r.mae?.id === 'mae'),
    saveEdited: false,
  };
  await writeFile(base + '/preflight.json', JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary));
} else {
  const status = await (await fetch('http://127.0.0.1:3000/api/status')).json();
  assert.equal(status.save.state, 'saved');
  assert.equal(status.save.recovered, false);
  const saved = await state('.cro-magnon-save/world.json');
  const expected = JSON.parse(await readFile(base + '/expected-private.json', 'utf8'));
  assert.deepEqual(
    projection(saved),
    expected,
    'Original session positions, inventory and progression survive startup',
  );
  assert.ok(saved.rooms.every((r) => r.mae?.id === 'mae'));
  const paths = [
    'src/main.js',
    'src/world3d.js',
    'src/mae-renderer.js',
    'shared/mae.mjs',
    'shared/combat.mjs',
    'models/mae/model-r01.glb',
    'models/mae/lod-r01.glb',
    'models/world-assets.json',
  ];
  const checks = [];
  for (const path of paths) {
    const response = await fetch('http://127.0.0.1:3000/' + path);
    assert.equal(response.status, 200, path);
    const sha256 = hash(Buffer.from(await response.arrayBuffer()));
    const local = (path.startsWith('models/') ? 'public/' : 'dist/') + path;
    assert.equal(sha256, hash(await readFile(local)), path);
    checks.push({ path, sha256 });
  }
  const record = {
    passed: true,
    rooms: saved.rooms.length,
    sessions: saved.rooms.reduce((n, r) => n + r.sessions.length, 0),
    preservedSessionData: true,
    save: status.save,
    served: checks,
    backup: base + '/before',
    manuallyEditedSave: false,
  };
  await writeFile('assets/mae/local-rollout.json', JSON.stringify(record, null, 2) + '\n');
  console.log(JSON.stringify(record));
}
