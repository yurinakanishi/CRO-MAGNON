// Delivered skins in an isolated game. Only the safe stage and camera are fixtures;
// character selection and petting go through the real UI and server actions.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createGameServer } from '../dist/server.mjs';
import { CHARACTER_MODELS } from '../dist/shared/characters.mjs';
import { stopActor } from '../dist/shared/combat.mjs';
import { COMPANION_524 } from '../dist/shared/companion-524.mjs';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const out =
  process.env.QA_524_PET_OUT || 'output/playwright/companion-524/natural-follow-r01/petting';
await mkdir(out, { recursive: true });
const game = createGameServer({ port: 0, host: '127.0.0.1' });
const { port } = await game.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [],
  checks = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, label) {
  const end = Date.now() + 30000;
  while (!(await fn())) {
    if (Date.now() > end) throw Error(label);
    await sleep(30);
  }
}
await page.route('**/src/world3d.js', async (route) => {
  const response = await route.fetch();
  await route.fulfill({
    response,
    body:
      (await response.text()) +
      '\nconst renderPet=WorldRenderer.prototype.render;WorldRenderer.prototype.render=function(...args){window.qaPet=this;window.qaThree=THREE;return renderPet.apply(this,args);};',
  });
});
try {
  await page.goto(`http://127.0.0.1:${port}/?room=PET-POSE-QA&autostart=1`);
  await page
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 120000 });
  const room = game.rooms.get('PET-POSE-QA');
  const p = [...room.players.values()][0],
    c = room.companion524;
  for (const character of CHARACTER_MODELS) {
    stopActor(p);
    Object.assign(p, { x: 46, z: 55.5 });
    Object.assign(c, {
      x: 46,
      z: 53.5,
      followPlayerId: null,
      mode: 'idle',
      petPlayerId: null,
      petContactAt: 0,
      petAt: 0,
      path: [],
      velocityX: 0,
      velocityZ: 0,
    });
    await sleep(250);
    if (p.species !== character.species || p.gender !== character.gender) {
      await page.keyboard.press('Escape');
      await page.locator('[data-controller-menu="character"]').click();
      await page
        .locator(
          `#character-switch-form .character-choice:has(input[value="${character.species}-${character.gender}"])`,
        )
        .click();
      await page.locator('#character-confirm-yes').click();
      await until(
        () =>
          page.evaluate(
            (key) => qaPet.players.get(qaPet.selfId)?.actor?.asset.modelKey === key,
            character.key,
          ),
        'new skin',
      );
      if (await page.locator('#modal').isVisible()) await page.keyboard.press('Escape');
    }
    // Respect the server's normal action interval after confirming a new skin.
    await sleep(650);
    await page.evaluate(() => {
      qaPet.yaw = 1.05;
      qaPet.pitch = 0.14;
      qaPet.targetDistance = 3.6;
      window.petFrames = [];
      const samples = window.petFrames;
      window.petRecordUntil = performance.now() + 6500;
      function sample() {
        const r = qaPet,
          a = r.players.get(r.selfId)?.actor;
        if (a && r.state.companion524)
          samples.push({
            at: r.serverNow(),
            contactAt: r.state.companion524.petContactAt,
            weight: a.pettingPose.weight,
            handGap: a.pettingPose.contact.distanceTo(a.pettingPose.requested),
            ...r.companion524Renderer.diagnostics(),
          });
        if (performance.now() < window.petRecordUntil) requestAnimationFrame(sample);
      }
      requestAnimationFrame(sample);
      const stream = document.querySelector('#world').captureStream(30);
      const recorder = new MediaRecorder(stream, {
        mimeType: 'video/webm;codecs=vp9',
        videoBitsPerSecond: 2400000,
      });
      const chunks = [];
      recorder.ondataavailable = (e) => chunks.push(e.data);
      window.petRecording = { recorder, stream, chunks };
      recorder.start();
    });
    await page.locator('#world').focus();
    await page.keyboard.press('v');
    await until(() => c.petContactAt > 0, `${character.key} hand approach`);
    await sleep(330);
    await page.screenshot({ path: `${out}/${character.key}-stroke.png` });
    await until(() => Date.now() >= c.petContactAt + COMPANION_524.petStrokeMs + 450, 'half spin');
    await page.screenshot({ path: `${out}/${character.key}-spin.png` });
    await until(
      () => page.evaluate(() => qaPet.companion524Renderer.diagnostics().hearts >= 3),
      'heart flourish',
    );
    await page.screenshot({ path: `${out}/${character.key}-hearts.png` });
    await sleep(800);
    const result = await page.evaluate(async () => {
      window.petRecordUntil = 0;
      const { recorder, stream, chunks } = window.petRecording;
      await new Promise((resolve) => {
        recorder.onstop = resolve;
        recorder.stop();
      });
      for (const track of stream.getTracks()) track.stop();
      const blob = new Blob(chunks, { type: recorder.mimeType });
      const video = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.readAsDataURL(blob);
      });
      return { samples: window.petFrames, video };
    });
    await writeFile(`${out}/${character.key}.webm`, Buffer.from(result.video, 'base64'));
    const strokes = result.samples.filter(
      (s) => s.weight > 0.99 && s.contactAt > 0 && s.at - s.contactAt > 150,
    );
    const maxGap = Math.max(...strokes.map((s) => s.handGap));
    assert.ok(strokes.length > 10 && maxGap < 0.04, `${character.key}: hand gap ${maxGap}`);
    assert.ok(
      result.samples.some((s) => s.spin > 6.27) && result.samples.some((s) => s.hearts >= 3),
      'one completed revolution and hearts',
    );
    checks.push({ character: character.key, maxHandGap: maxGap, samples: result.samples });
    console.log('PASS', character.key, 'hand gap', maxGap.toFixed(4), 'm; spin and hearts');
    if (character.species === 'bear') {
      await page.locator('#world').focus();
      await page.keyboard.press('v');
      await until(() => c.petContactAt > Date.now() - 1000, 'repeat pet before interruption');
      await sleep(500);
      await page.evaluate(() => {
        window.cancelHeights = [];
        const end = performance.now() + 1000;
        function sample() {
          const d = qaPet.companion524Renderer.diagnostics();
          window.cancelHeights.push({ at: performance.now(), height: d.y - d.floor });
          if (performance.now() < end) requestAnimationFrame(sample);
        }
        requestAnimationFrame(sample);
      });
      await page.keyboard.down('w');
      await sleep(350);
      await page.keyboard.up('w');
      await until(() => !c.petPlayerId, 'walking cancels the stroke');
      await sleep(750);
      const heights = await page.evaluate(() => window.cancelHeights);
      const maxStep = Math.max(
        ...heights.slice(1).map((s, i) => Math.abs(s.height - heights[i].height)),
      );
      assert.ok(maxStep < 0.14, `interrupting the low hover popped ${maxStep}m in one frame`);
      checks.push({ interruption: 'mage walks away', maxHeightStep: maxStep, samples: heights });
      console.log('PASS interrupted low pet returns smoothly to its ordinary hover');
    }
  }
  assert.deepEqual(errors, []);
} finally {
  await writeFile(
    `${out}/result.json`,
    JSON.stringify(
      {
        checks,
        errors,
        fixtures: ['safe stage coordinates', 'side camera'],
        requestedVideoFps: 30,
      },
      null,
      2,
    ),
  );
  await browser.close();
  await game.close();
}
