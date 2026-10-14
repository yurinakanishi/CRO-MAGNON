import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const base = process.argv[2] || 'https://cromagnonmmo.cro-magnon.workers.dev';
const build = JSON.parse(await readFile('output/cloudflare-build.json', 'utf8'));
assert.ok(['public', 'full'].includes(build.credits), 'Unknown credits profile');
const includeSupervisors = build.credits === 'full';
// Verify the browser bundle served by the page as well as its source modules.
const browserBundle = build.browserBundle;
assert.ok(browserBundle?.entry, 'release omits browser bundle metadata');
const browserBundleFiles = browserBundle.outputs.map((file) => file.name);
assert.ok(browserBundleFiles.includes(browserBundle.entry), 'browser bundle omits its entry');
const titleShellFiles = [
  'src/boot.js',
  'src/title-shell.js',
  'src/icons.js',
  'src/startup-marks.js',
  'shared/friend-mascot-roster.mjs',
];
for (const required of [...titleShellFiles, ...browserBundleFiles])
  assert.ok(
    build.publicFiles.some((file) => file.path === required),
    `release omits ${required}`,
  );
const paths = new Set([
  ...titleShellFiles,
  ...browserBundleFiles,
  'src/main.js',
  'src/asset-download.js',
  'src/title-credits.js',
  'src/title-credit-profiles.js',
  'src/title.css',
  'src/style.css',
  'src/character-assets.js',
  'src/clothing-dye.js',
  'src/clothing-dye-rules.js',
  'shared/characters.mjs',
  'shared/character-profiles.mjs',
  'multiplayer-config.json',
  'models/world-assets.json',
]);
const files = build.publicFiles.filter(
  (file) =>
    paths.has(file.path) ||
    /^models\/.*\.png$/.test(file.path) ||
    /^title\/(?:qr|avatar)-/.test(file.path),
);
for (const file of files) {
  const response = await fetch(`${base}/${file.path}`);
  assert.equal(response.status, 200, file.path);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(bytes.length, file.bytes, file.path);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256, file.path);
}
const page = await fetch(`${base}/`).then((r) => r.text());
assert.deepEqual(
  [...page.matchAll(/<script type="module" src="([^"]+)"/g)].map((match) => match[1]),
  [`/${browserBundle.entry}`],
  'the released page starts from the recorded browser bundle',
);
const profiles = await fetch(`${base}/src/title-credit-profiles.js`).then((r) => r.text());
assert.match(profiles, /yuri/);
assert.match(profiles, /R-524/);
assert.match(profiles, /vibe_walking/);
assert.match(profiles, /OpenAI Dots/);
for (const handle of ['WabisukeTyper', 'nukonuko', 'otani_ai_memo', 'yuki_urata'])
  if (includeSupervisors) assert.ok(profiles.includes(handle), handle);
  else assert.ok(!profiles.includes(handle), handle);
const excluded = [];
for (const name of ['ryuichi', 'nukonuko', 'otani', 'urata']) {
  for (const file of [`qr-${name}.png`, `avatar-${name}.jpg`]) {
    const url = `/title/${file}`;
    assert.equal((await fetch(base + url)).status, 404, url);
    excluded.push(url);
  }
}
const config = await fetch(`${base}/multiplayer-config.json`).then((r) => r.json());
assert.equal(config.mode, 'online');
assert.equal(config.room, 'EMBER');
assert.equal(config.movementRefreshMs, 140);
const publicCharacters = await fetch(`${base}/shared/character-profiles.mjs`).then((r) => r.text());
assert.doesNotMatch(publicCharacters, /maruimo|まる[ぃい]も/i);
const dyeRules = await fetch(`${base}/src/clothing-dye-rules.js`).then((r) => r.text());
assert.doesNotMatch(dyeRules, /maruimo-octopus|MaruimoOctopusSurface/);
assert.match(dyeRules, /cro-magnon-woman/);
const privateAsset = JSON.parse(await readFile('public/models/maruimo-octopus/asset.json', 'utf8'));
const excludedCharacterFiles = [
  '/models/maruimo-octopus/asset.json',
  '/models/maruimo-octopus/portrait.png',
  privateAsset.url,
  ...privateAsset.lods.map((lod) => lod.url),
  '/src/octopus-pose.js',
];
for (let part = 1; part <= Math.ceil(privateAsset.bytes / (24 * 1024 * 1024)); part++)
  excludedCharacterFiles.push(
    `${privateAsset.url.slice(0, -4)}-${privateAsset.sha256.slice(0, 12)}.part-${part}.bin`,
  );
for (const url of excludedCharacterFiles) assert.equal((await fetch(base + url)).status, 404, url);
const report = {
  checkedAt: new Date().toISOString(),
  base,
  status: 'passed',
  servedFilesVerified: files.length,
  titleShellFilesVerified: titleShellFiles.length,
  browserBundleFilesVerified: browserBundleFiles.length,
  publicCreditsOnly: !includeSupervisors,
  supervisorCreditsIncluded: includeSupervisors,
  excludedSupervisorFiles: excluded,
  runtimeTexturesVerified: files.filter((file) => /^models\/camp-cave\/.*\.png$/.test(file.path))
    .length,
  publicCharacterCount: build.characters.length,
  publicClothingDyeRulesVerified: true,
  excludedCharacterFiles,
};
await writeFile('assets/cloudflare/public-release-qa.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
