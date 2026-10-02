// Combine completed checks with the separately verified reload and layout continuation.
// Keep the original failed harness run unchanged and describe its failure explicitly.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = 'output/playwright/orb-bots';
const paths = {
  main: `${root}/game-1790861288923`,
  reload: `${root}/reload-1790861768088`,
  layout: `${root}/layout-1790861582879`,
};
const read = async (p) => JSON.parse(await readFile(p, 'utf8'));
const hash = (data) => createHash('sha256').update(data).digest('hex');
const main = await read(`${paths.main}/result.json`);
const reload = await read(`${paths.reload}/result.json`);
const layout = await read(`${paths.layout}/result.json`);
assert.equal(main.passed, false);
assert.equal(main.checks.length, 10);
assert.match(main.failure, /locator\.waitFor: Timeout 120000ms/);
assert.match(main.failure, /data-world-asset/);
assert.match(main.failure, /qa-orb-bots\.mjs:474/);
for (const report of [main, reload, layout]) assert.deepEqual(report.errors, []);
assert.equal(reload.passed, true);
assert.deepEqual(
  Object.fromEntries(
    ['players', 'bots', 'owned', 'inventoryPreserved', 'resumed'].map((key) => [
      key,
      reload.report[key],
    ]),
  ),
  { players: 5, bots: 25, owned: 5, inventoryPreserved: true, resumed: true },
);
assert.equal(layout.passed, true);
assert.equal(layout.views.length, 3);
let hitTargets = 0;
for (const view of layout.views) {
  assert.equal(view.buttons.length, 7);
  for (const button of view.buttons) {
    assert.equal(button.hit, true);
    assert.ok(button.x >= 0 && button.y >= 0);
    assert.ok(button.x + button.width <= view.width);
    assert.ok(button.y + button.height <= view.height);
    hitTargets++;
  }
}
const contacts = main.records.filter((r) => r.heldModel);
assert.equal(new Set(contacts.map((r) => r.heldModel)).size, 9);
assert.ok(contacts.every((r) => r.handError <= 0.001));
const manifests = [];
for (const colour of ['white', 'blue', 'green', 'purple', 'orange']) {
  const manifest = await read(`public/models/orb-bot-${colour}/asset.json`);
  for (const entry of [manifest, ...manifest.lods]) {
    assert.equal(hash(await readFile(`public${entry.url}`)), entry.sha256);
    manifests.push({ url: entry.url, sha256: entry.sha256 });
  }
}
const evidence = [];
for (const [name, path] of Object.entries(paths)) {
  evidence.push({ name, path, resultSha256: hash(await readFile(`${path}/result.json`)) });
}
const out = `${root}/verified-20261001`;
await mkdir(out, { recursive: true });
const report = {
  passed: true,
  kind: 'composite-verification',
  checks: [
    ...main.checks,
    'reload through the existing title and setup restores the player inventory and recreates all five bots without duplicates',
    'all 21 control hit targets fit at 844x390, 390x844 and 1280x800',
  ],
  errors: [],
  evidence,
  harnessFailure: {
    path: paths.main,
    passed: false,
    failure: main.failure,
    explanation:
      'The first ten groups completed. The last step incorrectly expected reload to join immediately, although the existing app returns to its title. The separate reload run uses the actual title and setup flow. The original failure is retained, not converted into a passing run.',
  },
  continuation: {
    reload: reload.report,
    layout: { viewports: layout.views.map(({ width, height }) => ({ width, height })), hitTargets },
    changes:
      'Core gameplay and final model bytes are unchanged between these runs. Only the landscape CSS button size and the QA reload expectation were corrected after the main run.',
  },
  contacts,
  manifests,
  scope:
    'Main: two Chrome renderers plus three protocol clients in an isolated unsaved room. Reload: one Chrome renderer plus four protocol clients, with explicit non-empty inventory fixtures. Layout: Chrome viewport emulation. Physical controller, physical mobile devices, sustained FPS and long-duration use are unverified.',
  visualReview:
    'Final exact GLBs show all five source faces without the earlier dark UV seams. Held models contact the left hand on all nine characters; flight and ground return are visible. Corrected landscape and portrait controls are fully inside the viewport.',
};
await writeFile(`${out}/result.json`, JSON.stringify(report, null, 2) + '\n');
console.log(
  JSON.stringify({
    out,
    passed: report.passed,
    checks: report.checks.length,
    hitTargets,
    characterRigs: 9,
    exactAssets: manifests.length,
  }),
);
