// Focus placement is a fixture for edge measurements; menu opening, tab
// activation and controller navigation run through the ordinary UI handlers.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createGameServer } from '../dist/server.mjs';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const baseline = process.argv.includes('--baseline');
const folder = `output/playwright/pause-focus-${baseline ? 'before' : 'after'}-${Date.now()}`;
await mkdir(folder, { recursive: true });
const game = createGameServer({ host: '127.0.0.1', port: 0 });
const { port } = await game.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [],
  observations = [],
  checks = [];
page.on('pageerror', (error) => errors.push(String(error)));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const pass = (message) => {
  checks.push(message);
  console.log('PASS', message);
};
async function pad(buttons = [], axes = [0, 0, 0, 0]) {
  await page.evaluate(
    ({ buttons, axes }) => {
      window.qaPad.axes = axes;
      window.qaPad.buttons = window.qaPad.buttons.map((_, index) => ({
        pressed: buttons.includes(index),
        value: buttons.includes(index) ? 1 : 0,
      }));
    },
    { buttons, axes },
  );
  await sleep(100);
}
async function inspect(selector, device, label) {
  await page.keyboard.press('Shift');
  const target = page.locator(selector);
  await target.focus();
  await target.scrollIntoViewIfNeeded();
  if (device === 'pad') {
    await pad();
    await pad([], [0, 0, 0.5, 0]);
    await pad();
  }
  await sleep(180);
  const result = await target.evaluate((el) => {
    const style = getComputedStyle(el),
      box = el.getBoundingClientRect();
    const outset = Math.max(0, parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset));
    const ring = {
      left: box.left - outset,
      right: box.right + outset,
      top: box.top - outset,
      bottom: box.bottom + outset,
    };
    const clips = [];
    for (let parent = el.parentElement; parent; parent = parent.parentElement) {
      const css = getComputedStyle(parent),
        rect = parent.getBoundingClientRect();
      const bounds = {
        left: rect.left + parent.clientLeft,
        right: rect.left + parent.clientLeft + parent.clientWidth,
        top: rect.top + parent.clientTop,
        bottom: rect.top + parent.clientTop + parent.clientHeight,
      };
      const edges = [];
      if (/(auto|scroll|hidden|clip)/.test(css.overflowX)) {
        if (ring.left < bounds.left - 1) edges.push('left');
        if (ring.right > bounds.right + 1) edges.push('right');
      }
      if (/(auto|scroll|hidden|clip)/.test(css.overflowY)) {
        if (ring.top < bounds.top - 1) edges.push('top');
        if (ring.bottom > bounds.bottom + 1) edges.push('bottom');
      }
      if (edges.length) clips.push({ parent: parent.className || parent.tagName, edges, bounds });
    }
    return {
      focused: el === document.activeElement,
      visible: el.matches(':focus-visible'),
      pad: el.classList.contains('gamepad-focus'),
      text: el.textContent.trim(),
      outline: style.outline,
      width: style.outlineWidth,
      offset: style.outlineOffset,
      shadow: style.boxShadow,
      box: box.toJSON(),
      ring,
      clips,
    };
  });
  assert.equal(result.focused, true, label);
  assert.ok(parseFloat(result.width) >= 2, `visible outline: ${label}`);
  if (device === 'pad') assert.equal(result.pad, true);
  observations.push({ label, device, selector, ...result });
  console.log(
    label,
    result.clips.length
      ? 'CLIPPED ' + JSON.stringify(result.clips.map((c) => ({ parent: c.parent, edges: c.edges })))
      : 'VISIBLE',
  );
  if (
    selector.includes('inventory') ||
    selector.includes('settings') ||
    selector.includes('objectives')
  )
    await page.screenshot({ path: `${folder}/${label}.png`, animations: 'disabled' });
}
try {
  await page.addInitScript(() => {
    window.qaPad = {
      id: 'Wireless Controller',
      index: 0,
      connected: true,
      mapping: 'standard',
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 18 }, () => ({ pressed: false, value: 0 })),
    };
    Object.defineProperty(navigator, 'getGamepads', { value: () => [window.qaPad] });
  });
  await page.goto(`http://127.0.0.1:${port}/?room=PAUSE-FOCUS-QA&autostart=1`);
  await page
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 90000 });
  await page.keyboard.press('Escape');
  console.log(await page.locator('#modal').ariaSnapshot());
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    const size = `${viewport.width}x${viewport.height}`;
    for (const device of ['keyboard', 'pad']) {
      for (const id of ['inventory', 'crafting', 'info', 'settings']) {
        const selector = `[data-pause-tab="${id}"]`;
        await inspect(selector, device, `${size}-${device}-${id}`);
        if (device === 'pad') {
          await pad([1]);
          await pad();
        } else await page.keyboard.press('Enter');
        assert.equal(await page.locator(selector).getAttribute('aria-selected'), 'true');
        assert.equal(await page.locator(`[data-pause-panel="${id}"]`).isVisible(), true);
      }
      await page.locator('[data-pause-tab="info"]').click();
      for (const id of ['help', 'world', 'tribe', 'objectives']) {
        const selector = `[data-pause-subtab="${id}"]`;
        await inspect(selector, device, `${size}-${device}-sub-${id}`);
        if (device === 'pad') {
          await pad([1]);
          await pad();
        } else await page.keyboard.press('Enter');
        assert.equal(await page.locator(selector).getAttribute('aria-selected'), 'true');
      }
    }
    pass(`${size}: main and sub-tabs activate from keyboard and simulated controller`);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.keyboard.press('Shift');
  await page.locator('[data-pause-tab="inventory"]').focus();
  await page.keyboard.press('ArrowDown');
  assert.equal(
    await page
      .locator('[data-pause-tab="crafting"]')
      .evaluate((el) => el === document.activeElement),
    true,
  );
  await pad();
  await pad([13]);
  await pad();
  assert.equal(
    await page.locator('[data-pause-tab="info"]').evaluate((el) => el === document.activeElement),
    true,
  );
  pass('Real keyboard and controller directional navigation still follows the tab rail');
  const clipped = observations.filter((sample) => sample.clips.length);
  console.log(`FOCUS CHECKS ${observations.length}; CLIPPED ${clipped.length}`);
  if (baseline) assert.ok(clipped.length > 0, 'Reproduce the reported clipping before the fix');
  else
    assert.deepEqual(
      clipped.map((sample) => sample.label),
      [],
    );
  assert.deepEqual(errors, []);
} finally {
  await writeFile(
    `${folder}/result.json`,
    JSON.stringify({ baseline, checks, observations, errors }, null, 2),
  );
  console.log('EVIDENCE', folder);
  await browser.close();
  await game.close();
}
