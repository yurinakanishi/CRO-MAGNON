// Local-only backup and comparison. Never restores or resets the user's save.
import assert from 'node:assert/strict';
import { readFile, writeFile, copyFile, mkdir, constants } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
const [mode, folder] = process.argv.slice(2);
const root = process.cwd(),
  destination = path.resolve(folder ?? '');
assert.ok(destination.startsWith(path.resolve('output/orb-bots-server') + path.sep));
const digest = (data) => createHash('sha256').update(data).digest('hex');
const files = ['world.json', 'world.backup.json'];
const parse = async (file) => {
  const value = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(
    value.sha256,
    digest(JSON.stringify({ revision: value.revision, state: value.state })),
  );
  return value.state;
};
await mkdir(destination, { recursive: true });
if (mode === 'backup') {
  const records = [];
  for (const file of files) {
    const source = path.join(root, '.cro-magnon-save', file),
      target = path.join(destination, file);
    await copyFile(source, target, constants.COPYFILE_EXCL);
    const original = await readFile(source),
      copy = await readFile(target);
    assert.equal(digest(original), digest(copy));
    await parse(target);
    records.push({ file, bytes: copy.length, sha256: digest(copy) });
  }
  const state = await parse(path.join(destination, 'world.json'));
  const report = {
    files: records,
    rooms: state.rooms.length,
    sessions: state.rooms.reduce((n, r) => n + r.sessions.length, 0),
    worldVersion: state.worldVersion,
  };
  await writeFile(path.join(destination, 'backup.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
} else if (mode === 'verify') {
  const before = await parse(path.join(destination, 'world.json'));
  const after = await parse(path.join(root, '.cro-magnon-save/world.json'));
  const changes = [],
    preserved = [];
  for (const room of before.rooms) {
    const current = after.rooms.find((r) => r.name === room.name);
    assert.ok(current, 'An existing room disappeared');
    for (const session of room.sessions) {
      const restored = current.sessions.find((s) => s.token === session.token);
      assert.ok(restored, 'An existing session disappeared');
      const fields = Object.keys(session.player).filter(
        (key) => JSON.stringify(session.player[key]) !== JSON.stringify(restored.player[key]),
      );
      const meaningful = fields.filter((key) => !['tokens', 'refillAt'].includes(key));
      if (meaningful.length)
        changes.push({ room: room.name, sessionHash: digest(session.token), fields: meaningful });
      else
        preserved.push({
          room: room.name,
          sessionHash: digest(session.token),
          rateLimitFieldsChanged: fields,
        });
    }
  }
  const report = {
    preservedSessions: preserved.length,
    changedSessions: changes,
    roomsBefore: before.rooms.length,
    roomsAfter: after.rooms.length,
    saveRestored: false,
    passed: changes.length === 0,
  };
  await writeFile(
    path.join(destination, 'verification.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(JSON.stringify(report));
  assert.equal(changes.length, 0, 'Investigate live-session changes; never roll the save back');
} else throw Error('Use backup or verify');
