// Audit the actual upload directories and run the public game rules locally.
// This never contacts Cloudflare or reads/uploads a private model's bytes.
import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CHARACTER_MODELS, characterModel } from '../dist/shared/characters.mjs';
import {
  CHARACTER_MODELS as publicCharacters,
  normalizeCharacter,
} from '../dist-cloudflare-worker/shared/characters.mjs';
import { createGameCore } from '../dist-cloudflare-worker/application/game-core.mjs';
import { assertPublicCharacterData } from './public-character-audit.mjs';

const excludedKeys = new Set(['maruimo-octopus']),
  excludedSpecies = new Set(['maruimo']);
const check = (name, bytes) =>
  assertPublicCharacterData(name, Buffer.from(bytes), excludedKeys, excludedSpecies);
let auditedFiles = 0;
async function audit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    assert.ok(!excludedKeys.has(entry.name), file);
    if (entry.isDirectory()) await audit(file);
    else {
      if (/\.(m?js|css|json|html|txt)$/.test(file)) check(file, await readFile(file));
      auditedFiles++;
    }
  }
}
await audit('dist-cloudflare');
await audit('dist-cloudflare-worker');
const upload = await readFile('output/cloudflare-dry-run/worker.js', 'utf8');
check('worker.js', upload);
assert.equal(CHARACTER_MODELS.length, 9);
assert.equal(characterModel({ species: 'maruimo' }).key, 'maruimo-octopus');
assert.equal(publicCharacters.length, 8);
assert.deepEqual(normalizeCharacter({ species: 'maruimo', gender: 'male' }), {
  species: 'cro',
  gender: 'male',
});
for (const model of publicCharacters) assert.deepEqual(model, characterModel(model));

class Socket {
  readyState = 1;
  bufferedAmount = 0;
  messages = [];
  handlers = {};
  on(type, handler) {
    this.handlers[type] = handler;
  }
  send(value) {
    this.messages.push(JSON.parse(value));
  }
  close() {
    this.readyState = 3;
    this.handlers.close?.();
  }
}
const core = createGameCore({ resumeGraceMs: 86400000, keepEmptyRooms: true });
const first = new Socket();
core.connect(
  first,
  new URLSearchParams({
    room: 'EMBER',
    name: 'Public privacy QA',
    species: 'maruimo',
    gender: 'male',
    resume: '1',
  }),
);
const welcome = first.messages.find((message) => message.type === 'welcome');
assert.equal(welcome.profile.species, 'cro');
check('messages.json', JSON.stringify(first.messages));
const saved = JSON.parse(JSON.stringify(core.exportState()));
saved.rooms[0].sessions[0].player.species = 'maruimo';
saved.rooms[0].sessions[0].player.inventory.wood = 11;
const restored = createGameCore({ resumeGraceMs: 86400000, keepEmptyRooms: true });
restored.importState(saved);
const resumed = new Socket();
restored.connect(
  resumed,
  new URLSearchParams({ room: 'EMBER', resume: '1', session: welcome.session }),
);
const back = resumed.messages.find((message) => message.type === 'welcome');
assert.equal(back.resumed, true);
assert.equal(back.profile.species, 'cro');
assert.equal(restored.rooms.get('EMBER').players.get(back.id).inventory.wood, 11);
check('messages.json', JSON.stringify(resumed.messages));
const report = {
  checkedAt: new Date().toISOString(),
  status: 'passed',
  auditedFiles,
  bundledWorkerAudited: true,
  publicCharacters: 8,
  localCharacters: 9,
  excludedCharacterNeverInOutboundPackets: true,
  priorInventoryPreserved: true,
};
await writeFile('assets/cloudflare/character-privacy-qa.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
