import assert from 'node:assert/strict';
import path from 'node:path';

// Called only by the isolated prerecorded-video harness, never the normal server.
export async function checkBeginnerUI(page, out, phase) {
  const screenshot = (name) => page.screenshot({ path: path.join(out, name + '.png') });
  if (phase === 'camera') {
    await page.evaluate(async () => {
      window.reviewApi = await import('/src/main.js');
    });
    await page.waitForFunction(() => {
      const r = window.reviewApi.beginnerCameraReview();
      const delta = r.yaw - r.heading - Math.PI;
      return r.manual === false && Math.abs(Math.atan2(Math.sin(delta), Math.cos(delta))) < 0.0001;
    });
    const before = await page.evaluate(() => window.reviewApi.beginnerCameraReview());
    await page.mouse.move(920, 420);
    await page.mouse.down();
    await page.mouse.move(1100, 540, { steps: 8 });
    await page.mouse.up();
    await page.mouse.wheel(0, -350);
    for (const key of ['x', '+', '-']) await page.keyboard.press(key);
    await page.evaluate(() => {
      window.qaPad = {
        id: 'Xbox 360 Controller',
        index: 0,
        connected: true,
        mapping: 'standard',
        axes: [0, 0, 0, 0],
        buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
        timestamp: performance.now(),
      };
    });
    await page.waitForFunction(
      () => document.querySelector('#input-cues')?.dataset.device === 'gamepad',
    );
    await page.evaluate(() => {
      window.qaPad.axes[2] = 1;
      window.qaPad.axes[3] = 1;
      for (const i of [4, 5, 11])
        window.qaPad.buttons[i] = { pressed: true, touched: true, value: 1 };
      window.qaPad.timestamp = performance.now();
    });
    await page.waitForFunction(() =>
      document.querySelector('[data-pad-control="rs"]')?.classList.contains('is-pressed'),
    );
    const after = await page.evaluate(() => window.reviewApi.beginnerCameraReview());
    assert.equal(after.manual, false);
    assert.equal(after.viewing, false);
    const delta = after.yaw - before.yaw;
    assert.ok(
      Math.abs(Math.atan2(Math.sin(delta), Math.cos(delta))) < 0.002,
      JSON.stringify({ before, after }),
    );
    assert.ok(Math.abs(after.pitch - before.pitch) < 0.002);
    assert.equal(after.distance, before.distance);
    await screenshot('automatic-camera');
    await page.evaluate(() => {
      window.qaPad = null;
    });
    return { phase, before, after };
  }
  if (phase === 'setup') {
    await page.locator('#motion-controls[data-state="CALIBRATING"]').waitFor({ timeout: 20000 });
    await screenshot('setup');
    assert.equal(await page.locator('#motion-debug-details').isVisible(), false);
    assert.equal(await page.locator('#motion-fingers').isVisible(), false);
    return { phase, text: await page.locator('#motion-setup').innerText() };
  }
  assert.equal(await page.locator('#motion-panel').isVisible(), false);
  assert.equal(await page.locator('#motion-hud').isVisible(), true);
  assert.equal(await page.locator('#motion-fingers').isVisible(), false);
  assert.equal(await page.locator('#motion-video').isVisible(), false);
  const layouts = [];
  for (const [width, height] of [
    [1280, 800],
    [390, 844],
    [844, 390],
  ]) {
    await page.setViewportSize({ width, height });
    const draws = await page.evaluate(() => window.reviewDraws);
    await page.waitForFunction((draws) => window.reviewDraws > draws + 3, draws);
    await screenshot(`play-${width}x${height}`);
    const box = await page.locator('#motion-controls').boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= width && box.y + box.height <= height);
    layouts.push({ width, height, box });
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.locator('#motion-open').click();
  await page.locator('#motion-controls[data-state="PAUSED"]').waitFor();
  await screenshot('movement-guide');
  await page.locator('[data-lesson="action"]').click();
  await screenshot('action-guide');
  assert.equal(await page.locator('[data-lesson-panel="move"]').isVisible(), false);
  assert.equal(await page.locator('[data-lesson-panel="action"]').isVisible(), true);
  assert.equal(await page.locator('#motion-debug-details').isVisible(), false);
  const frame = await page.evaluate(() => window.reviewApi.handVideoReview().metrics.frames);
  await page.waitForFunction(
    (frame) => window.reviewApi.handVideoReview().metrics.frames > frame + 6,
    frame,
  );
  assert.equal(await page.getAttribute('#motion-controls', 'data-state'), 'PAUSED');
  assert.equal(await page.evaluate(() => window.reviewApi.handVideoReview().intent.forward), 0);
  await page.locator('#motion-settings > summary').click();
  await page.locator('#motion-debug-details > summary').click();
  assert.equal(await page.locator('#motion-fingers').isVisible(), true);
  await page.locator('#motion-fold').click();
  await page.locator('#motion-controls[data-state="ACTIVE"]').waitFor({ timeout: 10000 });
  assert.equal(await page.locator('#motion-hud').isVisible(), true);
  return { phase, layouts, pausedDuringHelp: true, resumed: true };
}
