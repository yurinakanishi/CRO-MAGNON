// In-game QA for remade assets: real Chrome + isolated in-memory server (never port 3000).
// Staging (player/animal positions, health, camera) is preparation on this throwaway server; moves,
// mounting (R), riding (W), attacks (F) and the server-side outcomes are real game input/state.
// Usage: QA_OUT=output/asset-remake/game/<label> QA_CHAR=cro-male node scripts/remake/qa-remake-game.mjs [mammoth,tent,player]
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { WebSocket } from 'ws';
import { createGameServer } from '../../dist/server.mjs';
const { chromium } =
  await import('file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');

const out = path.resolve(process.env.QA_OUT ?? 'output/asset-remake/game/run');
const character = process.env.QA_CHAR ?? 'cro-female';
const scenes = (process.argv[2] ?? 'mammoth,tent,player').split(',');
await mkdir(out, { recursive: true });
const game = createGameServer({ port: 0, host: '127.0.0.1' });
const { port } = await game.listen();
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'],
});
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
const errors = [],
  log = [],
  peers = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const note = (m, extra = {}) => {
  log.push({ t: new Date().toISOString(), m, ...extra });
  console.error(m);
};
async function until(fn, label, timeout = 60000) {
  const end = Date.now() + timeout;
  while (!(await fn())) {
    if (Date.now() > end) throw Error('timeout: ' + label);
    await sleep(100);
  }
}
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text().slice(0, 400));
});
const normal = game.server.listeners('request')[0];
game.server.removeAllListeners('request');
game.server.on('request', async (req, res) => {
  if (new URL(req.url, 'http://x').pathname === '/src/world3d.js') {
    const body = Buffer.from(
      (await readFile('dist/src/world3d.js', 'utf8')) +
        '\nconst __r=WorldRenderer.prototype.render;WorldRenderer.prototype.render=function(...a){window.qa=this;return __r.apply(this,a);};',
    );
    res.writeHead(200, { 'Content-Type': 'text/javascript', 'Content-Length': body.length });
    return res.end(body);
  }
  return normal(req, res);
});
const shot = (name) => page.screenshot({ path: path.join(out, name + '.png') });
const cam = (o) =>
  page.evaluate((o) => {
    Object.assign(qa, o);
  }, o);
const key = async (k, ms = 120) => {
  await page.keyboard.down(k);
  await sleep(ms);
  await page.keyboard.up(k);
};
const report = { character, scenes: {} };
try {
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.locator('#title-start').click();
  await page.locator(`#setup-form .character-choice:has(input[value="${character}"])`).click();
  await page.locator('#setup-flow [data-choose-difficulty="normal"]').click();
  await page.locator('#setup-flow-yes').click();
  await page
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 300000 });
  await until(() => game.rooms.get('EMBER')?.players.size === 1, 'joined');
  const room = game.rooms.get('EMBER');
  const me = [...room.players.values()][0];
  await page.locator('#world').focus();
  if (scenes.includes('mammoth')) {
    const m = room.animals[0];
    const s = (report.scenes.mammoth = { animal: m.id, steps: [] });
    // Close views: stand 9 m to the side, look across the animal from three yaws.
    Object.assign(me, { x: m.x + 9, z: m.z, facing: -Math.PI / 2 });
    await sleep(5000);
    for (const [i, yaw] of [Math.PI / 2, Math.PI / 2 + 0.7, Math.PI / 2 - 0.9].entries()) {
      await cam({ yaw, pitch: 0.15, targetDistance: 7 });
      await sleep(900);
      await shot(`mammoth-view-${i}`);
    }
    // Mount with the real key: stand next to it and press R.
    Object.assign(me, { x: m.x + 2.8, z: m.z, facing: -Math.PI / 2 });
    await sleep(800);
    await key('r');
    await until(() => me.mountId === m.id && m.riderId === me.id, 'mounted', 15000);
    s.steps.push('mounted with R');
    await cam({ yaw: Math.PI / 2 + 0.6, pitch: 0.2, targetDistance: 9 });
    await sleep(1200);
    await shot('mammoth-ridden-idle');
    const start = { x: m.x, z: m.z };
    await page.keyboard.down('w');
    await sleep(1600);
    await shot('mammoth-ridden-walk');
    await page.keyboard.down('Shift');
    await sleep(1600);
    await shot('mammoth-ridden-run');
    await page.keyboard.up('Shift');
    await page.keyboard.up('w');
    s.rideDistance = Math.hypot(m.x - start.x, m.z - start.z);
    await sleep(600);
    await key('r');
    await until(() => !me.mountId && !m.riderId, 'dismounted', 15000);
    s.steps.push(`rode ${s.rideDistance.toFixed(2)} m, dismounted with R`);
    // Hunt: lower health (prep), face it and attack with F until it falls; watch Death and meat.
    m.health = 20;
    Object.assign(me, {
      x: m.x + Math.sin(m.facing + Math.PI / 2) * 3.4,
      z: m.z + Math.cos(m.facing + Math.PI / 2) * 3.4,
    });
    me.facing = Math.atan2(m.x - me.x, m.z - me.z);
    await sleep(500);
    await cam({ yaw: me.facing + Math.PI + 0.6, pitch: 0.18, targetDistance: 8 });
    for (let i = 0; i < 6 && m.phase === 'alive'; i++) {
      me.facing = Math.atan2(m.x - me.x, m.z - me.z);
      await key('f');
      for (let w = 0; w < 19 && m.phase === 'alive'; w++) await sleep(50);
      if (m.phase === 'alive') await sleep(100);
    }
    s.phaseAfterAttacks = m.phase;
    if (m.phase === 'dying') {
      await sleep(350);
      await shot('mammoth-death-early');
      await sleep(350);
      await shot('mammoth-death-mid');
      await until(() => m.phase === 'meat', 'meat', 10000);
      await sleep(700);
      await shot('mammoth-meat');
      s.steps.push('killed with F, Death played, meat appeared');
    }
  }
  if (scenes.includes('tent')) {
    const tent = (await import('../../dist/shared/scenery-layout.mjs')).SCENERY?.tents?.[0];
    const t = tent ?? { x: 44, z: 46 };
    Object.assign(me, { x: t.x + 6, z: t.z + 6, facing: Math.atan2(t.x - me.x, t.z - me.z) });
    await sleep(3000);
    for (const [i, yaw] of [0.8, 2.4, -0.8].entries()) {
      await cam({
        yaw: Math.atan2(me.x - t.x, me.z - t.z) + i * 0.9,
        pitch: 0.2,
        targetDistance: 9,
      });
      await sleep(900);
      await shot(`tent-view-${i}`);
    }
    report.scenes.tent = { at: t };
  }
  if (scenes.includes('weapons')) {
    // Fitted obsidian head (prep on this throwaway server) -> the held weapon becomes the obsidian spear; a real F
    // thrust shows it in the hands.
    Object.assign(me, { x: 49, z: 60, facing: Math.PI, spearHead: 'obsidian' });
    await until(
      () => page.evaluate((id) => qa.players.get(id)?.weapon?.userData?.assetKey === 'obsidian-spear', me.id),
      'obsidian spear held',
      60000,
    );
    await cam({ yaw: -Math.PI / 2, pitch: 0.1, targetDistance: 3.5 });
    await sleep(1000);
    await shot('weapon-obsidian-idle');
    await cam({ yaw: Math.PI / 4, pitch: 0.15, targetDistance: 3.5 });
    await sleep(1000);
    await shot('weapon-obsidian-idle-front');
    const idleWeapon = await page.evaluate((id) => {
      const e = qa.players.get(id),
        w = e.weapon;
      w.updateMatrixWorld(true);
      let visible = true;
      for (let n = w; n; n = n.parent) visible &&= n.visible;
      const p = w.getWorldPosition(new w.position.constructor());
      return { visible, parent: w.parent?.name, world: p.toArray().map((v) => +v.toFixed(3)) };
    }, me.id);
    await key('f');
    await sleep(330);
    await shot('weapon-obsidian-thrust');
    report.scenes.weapons = {
      held: await page.evaluate((id) => qa.players.get(id)?.weapon?.userData?.assetKey, me.id),
      idleWeapon,
    };
  }
  if (scenes.includes('player')) {
    // Four protocol peers of other species around the browser player at camp.
    for (const sp of ['cro', 'nea', 'cat', 'howkey']) {
      const ws = new WebSocket(
        `ws://127.0.0.1:${port}/ws?${new URLSearchParams({ room: 'EMBER', name: 'QA ' + sp, species: sp, gender: 'male' })}`,
      );
      peers.push(ws);
      await new Promise((r, j) => {
        ws.once('open', r);
        ws.once('error', j);
      });
    }
    await until(() => room.players.size === 5, 'five players');
    [...room.players.values()].forEach((p, i) =>
      Object.assign(p, {
        x: 49 + [0, -1.6, 1.6, -0.8, 0.8][i],
        z: 58 + [0, 1, 1, 2.4, 2.4][i],
        facing: Math.PI,
      }),
    );
    await sleep(5000);
    await cam({ yaw: 0, pitch: 0.12, targetDistance: 5 });
    await sleep(900);
    await shot('players-front');
    await page.keyboard.down('w');
    await sleep(1200);
    await shot('player-walk');
    await page.keyboard.down('Shift');
    await sleep(1200);
    await shot('player-run');
    await page.keyboard.up('Shift');
    await page.keyboard.up('w');
    await sleep(400);
    await key('f');
    await sleep(330);
    await shot('player-attack-impact');
    report.scenes.player = { players: room.players.size };
  }
  if (scenes.includes('crows')) {
    // One crow of every rank: the rank group must hold its loaded TRELLIS prop meshes (or the focus orb).
    const s = (report.scenes.crows = {});
    const crows = room.enemies.filter((e) => e.modelKey === 'crow-shaman');
    for (const role of ['soldier', 'brute', 'shaman', 'prelate', 'pontiff']) {
      const c = crows.find((e) => e.crowRole === role);
      if (!c) continue;
      Object.assign(me, { x: c.x + 5, z: c.z + 5 });
      me.facing = Math.atan2(c.x - me.x, c.z - me.z);
      await until(
        () => page.evaluate((id) => !!qa.enemies.get(id)?.actor, c.id),
        `crow ${role} loaded`,
        120000,
      );
      const info = await page.evaluate((id) => {
        const e = qa.enemies.get(id);
        const groups = [];
        e.actor.root.traverse((g) => {
          if (!g.isGroup || !/^Crow/.test(g.name)) return;
          let meshes = 0,
            triangles = 0;
          g.traverse((n) => {
            if (n.isMesh) {
              meshes++;
              triangles += (n.geometry.index?.count ?? n.geometry.attributes.position.count) / 3;
            }
          });
          groups.push({ name: g.name, bone: g.parent?.name, meshes, triangles });
        });
        return groups;
      }, c.id);
      await cam({ yaw: Math.atan2(me.x - c.x, me.z - c.z), pitch: 0.12, targetDistance: 7 });
      await sleep(1500);
      await shot(`crow-${role}`);
      s[role] = { id: c.id, scale: c.scale, groups: info };
    }
  }
  if (scenes.includes('berries')) {
    const b = room.resources.find((r) => r.type === 'berry' && r.amount > 0);
    Object.assign(me, { x: b.x + 2.2, z: b.z + 2.2 });
    me.facing = Math.atan2(b.x - me.x, b.z - me.z);
    await until(
      () => page.evaluate((id) => (qa.resources.get(id)?.fruit?.children.length ?? 0) > 0, b.id),
      'berry clusters',
      60000,
    );
    const fruit = await page.evaluate((id) => {
      const f = qa.resources.get(id).fruit;
      return { clusters: f.children.length, visible: f.children.filter((c) => c.visible).length };
    }, b.id);
    await cam({ yaw: Math.atan2(me.x - b.x, me.z - b.z), pitch: 0.25, targetDistance: 3.2 });
    await sleep(1200);
    await shot('berry-bush');
    report.scenes.berries = { id: b.id, amount: b.amount, maxAmount: b.maxAmount, ...fruit };
  }
  if (scenes.includes('guests')) {
    Object.assign(me, { x: 49, z: 56, facing: Math.PI });
    await sleep(6000);
    const c524 = room.companion524;
    if (c524) {
      await cam({ yaw: Math.atan2(me.x - c524.x, me.z - c524.z), pitch: 0.15, targetDistance: 6 });
      await sleep(1200);
      await shot('guest-524');
    }
    await cam({ yaw: 0, pitch: 0.3, targetDistance: 14 });
    await sleep(1200);
    await shot('guests-camp');
    report.scenes.guests = await page.evaluate(
      () => document.querySelector('#world').dataset.characterAsset,
    );
  }
  if (scenes.includes('landmarks')) {
    const { LANDMARKS } = await import('../../dist/shared/landmarks.mjs');
    const { REGION_FEATURES } = await import('../../dist/shared/region-features.mjs');
    const s = (report.scenes.landmarks = {});
    for (const id of [
      'glacier-gate',
      'volcano-main',
      'desert-cactus-1',
      'volcanic-basalt-columns-1',
    ]) {
      const l = [...LANDMARKS, ...REGION_FEATURES].find((p) => p.id === id);
      const away = (l.clearance ?? 4) + 6;
      Object.assign(me, { x: l.x + away, z: l.z + away });
      me.facing = Math.atan2(l.x - me.x, l.z - me.z);
      await sleep(12000);
      await cam({ yaw: Math.atan2(me.x - l.x, me.z - l.z), pitch: 0.2, targetDistance: 10 });
      await sleep(1500);
      await shot(`landmark-${id}`);
      s[id] = {
        key: l.key,
        at: [l.x, l.z],
        landmarks: await page.evaluate(() => document.querySelector('#world').dataset.landmarks),
      };
    }
  }
  if (scenes.includes('coastal')) {
    // Shell bed (instanced cockles), a midden with shells (prep: shell count set on this throwaway server) and
    // the obsidian blade on a knapping table.
    const { SHELL_BEDS, MIDDEN_SITES, KNAPPING_SITES } =
      await import('../../dist/shared/coastal-sites.mjs');
    const s = (report.scenes.coastal = {});
    // The sites are filtered to the gulf region, removed from the world on 2026-09-22: nothing to show then.
    if (!SHELL_BEDS.length || !MIDDEN_SITES.length || !KNAPPING_SITES.length)
      s.note = `no coastal sites in the current world (beds ${SHELL_BEDS.length}, middens ${MIDDEN_SITES.length}, knapping ${KNAPPING_SITES.length})`;
    else {
      const bed = SHELL_BEDS[0];
      Object.assign(me, { x: bed.x + 3, z: bed.z + 3 });
      await until(
        () => page.evaluate(() => (qa.coastalRenderer?.shells.length ?? 0) > 0),
        'shell instances',
        120000,
      );
      await sleep(1500);
      s.shellInstances = await page.evaluate(() => qa.coastalRenderer.shells.map((m) => m.count));
      s.shellBed = room.gulf?.shellBeds?.find((b) => b.id === bed.id);
      await cam({ yaw: Math.atan2(me.x - bed.x, me.z - bed.z), pitch: 0.45, targetDistance: 3.5 });
      await sleep(1200);
      await shot('coastal-shell-bed');
      const site = MIDDEN_SITES[0];
      const midden = room.gulf.middens.find((m) => m.id === site.id);
      midden.shells = 30;
      Object.assign(me, { x: site.x + 4, z: site.z + 4 });
      await until(
        () => page.evaluate(() => (qa.coastalRenderer?.middens.size ?? 0) > 0),
        'midden',
        120000,
      );
      await cam({ yaw: Math.atan2(me.x - site.x, me.z - site.z), pitch: 0.3, targetDistance: 5 });
      await sleep(1500);
      await shot('coastal-midden');
      s.midden = { id: site.id, shells: midden.shells };
      const knap = KNAPPING_SITES[0];
      Object.assign(me, { x: knap.x + 2, z: knap.z + 2 });
      await until(
        () => page.evaluate(() => (qa.coastalRenderer?.blades.size ?? 0) > 0),
        'knapping blade',
        120000,
      );
      await cam({ yaw: Math.atan2(me.x - knap.x, me.z - knap.z), pitch: 0.5, targetDistance: 2.4 });
      await sleep(1500);
      await shot('coastal-knapping-blade');
      s.blade = await page.evaluate(() => {
        const b = [...qa.coastalRenderer.blades.values()][0];
        b.updateMatrixWorld(true);
        let min = Infinity,
          max = -Infinity;
        b.traverse((n) => {
          if (!n.isMesh) return;
          n.geometry.computeBoundingBox();
          const bb = n.geometry.boundingBox.clone().applyMatrix4(n.matrixWorld);
          min = Math.min(min, bb.min.y);
          max = Math.max(max, bb.max.y);
        });
        return { worldMinY: min, worldMaxY: max, position: b.position.toArray() };
      });
    }
  }
} catch (e) {
  report.failure = String(e?.stack ?? e);
} finally {
  report.errors = errors;
  report.log = log;
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  for (const ws of peers) ws.close();
  await browser.close();
  await game.close();
}
console.log(
  JSON.stringify(
    { failure: report.failure, errors: errors.length, scenes: report.scenes },
    null,
    1,
  ),
);
