import { readFile, writeFile } from 'node:fs/promises';
const json = async (p) => JSON.parse((await readFile(p, 'utf8')).replace(/^\uFEFF/, ''));
const root = 'assets/coastal-craft/';
const game = await json(root + 'game-qa/r01/report.json');
const appearance = await json(root + 'appearance-qa/r02/report.json');
const delivery = await json(root + 'delivery-qa.json');
const rollout = await json(root + 'rollout/report.json');
const archive = await json(root + 'archive-qa.json');
const testLog = await readFile('output/coastal-craft/all-tests-final.txt', 'utf8');
if (!testLog.includes('pass 252') || !testLog.includes('fail 0'))
  throw Error('Missing full test result');
const report = {
  at: new Date().toISOString(),
  status: 'complete-local',
  world: {
    version: 4,
    width: 8192,
    depth: 4096,
    gulfVersion: 2,
    beds: 5,
    middens: 4,
    workshops: 4,
    existingObsidianOutcrops: 8,
  },
  tests: {
    passed: 252,
    failed: 0,
    typeScript: 'normal, Cloudflare and strict build passed',
    architecture: 'passed',
    syntax: 'passed',
    prettier: 'all TypeScript source passed',
    whitespace: 'git diff --check passed',
  },
  browser: {
    renderedPages: game.renderedPages,
    communicationPeers: game.peers,
    maxPlayers: game.maxPlayers,
    samples: game.samples,
    staticOrCoastCollisionViolations: game.collisionViolations.length,
    errors: game.errors,
    allSixAppearances: appearance.status,
    gearAndReload: appearance.results.map((r) => ({
      key: r.profile.key,
      spearHead: r.spearHead,
      weapon: r.weapon.id,
      sameSession: r.idRetained,
    })),
    viewports: rollout.viewports,
    observationsFPS: game.fps.map((r) => Number(r.fps)),
    fixtures: game.fixtures,
    notes: game.notes,
  },
  assets: {
    models: delivery.models,
    deliveredGLBs: delivery.deliveredGLBs,
    newGLBs: delivery.newGLBs,
    originalModelsPreserved: delivery.originalModelsPreserved,
    archive: {
      status: archive.status,
      files: archive.files,
      bytes: archive.bytes,
      overwritten: archive.overwritten,
      deleted: archive.deleted,
    },
  },
  rollout: {
    status: rollout.status,
    url: 'http://127.0.0.1:3000',
    previousPid: 40220,
    pid: 27060,
    roomsBefore: rollout.health.rooms,
    playersBefore: rollout.health.players,
    servedGLBs: rollout.servedGLBs,
    oldCheckpointApplied: false,
    publicDeployed: false,
    billingChanged: false,
  },
  limitations: [
    'Physical mobile devices and physical gamepads untested; standard Gamepad API input simulated.',
    'Eight-player core inventory contention is not a large-player performance test.',
    'Observed FPS includes initial loading and is not a continuous performance guarantee.',
    'Original missing flint-spear reference/dense and older neanderthal adoption history are recorded as missing, not reconstructed.',
    'NPC daily routines, additional crops, maritime weather/currents and larger-player load testing remain on the broader roadmap.',
  ],
};
await writeFile(root + 'qa-summary.json', JSON.stringify(report, null, 2) + '\n');
console.log(
  JSON.stringify({
    status: report.status,
    tests: report.tests.passed,
    samples: report.browser.samples,
    models: delivery.models,
    archiveFiles: archive.files,
  }),
);
