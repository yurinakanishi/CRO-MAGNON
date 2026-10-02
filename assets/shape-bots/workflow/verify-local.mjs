// Read the normal server and match every new delivery; never join or reset a room.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const base = 'http://127.0.0.1:3000';
const digest = (b) => createHash('sha256').update(b).digest('hex');
const json = async (p) => JSON.parse(await readFile(p, 'utf8'));
const report = { health: null, status: null, matches: [] };
for (const endpoint of ['health', 'status']) {
  const response = await fetch(`${base}/api/${endpoint}`);
  assert.equal(response.status, 200);
  report[endpoint] = await response.json();
  assert.equal(report[endpoint].ok, true);
  assert.equal(report[endpoint].save.enabled, true);
  assert.equal(report[endpoint].save.recovered, false);
}
for (const colour of [
  'white',
  'blue',
  'green',
  'purple',
  'orange',
  'beret',
  'frog',
  'triangle',
  'heart',
]) {
  const local = await json(`public/models/orb-bot-${colour}/asset.json`);
  const remote = await (await fetch(`${base}/models/orb-bot-${colour}/asset.json`)).json();
  assert.deepEqual(remote, local);
  for (const entry of [local, ...local.lods, ...(local.portrait ? [local.portrait] : [])]) {
    const response = await fetch(base + entry.url);
    assert.equal(response.status, 200);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (entry.bytes !== undefined) assert.equal(bytes.length, entry.bytes);
    assert.equal(digest(bytes), entry.sha256);
    report.matches.push({ url: entry.url, sha256: entry.sha256, bytes: bytes.length });
  }
}
for (const url of [
  '/src/main.js',
  '/src/world3d.js',
  '/src/orb-bot-pose.js',
  '/src/orb-bot-renderer.js',
  '/src/orb-bot-ui.js',
  '/src/orb-bots.css',
  '/src/gamepad-input.js',
  '/src/help-content.js',
  '/shared/orb-bots.mjs',
]) {
  const response = await fetch(base + url);
  assert.equal(response.status, 200);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(digest(bytes), digest(await readFile('dist' + url)));
  report.matches.push({ url, sha256: digest(bytes), bytes: bytes.length });
}
await writeFile('assets/shape-bots/local-delivery.json', JSON.stringify(report, null, 2) + '\n');
console.log(
  JSON.stringify({
    players: report.health.players,
    rooms: report.health.rooms,
    matches: report.matches.length,
    saveRecovered: report.status.save.recovered,
  }),
);
