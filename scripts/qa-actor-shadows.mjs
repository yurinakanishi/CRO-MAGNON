// Isolated world; normal start/mount/walk/run inputs. Poses/cameras for the
// same-frame shadow comparison are explicit inspection fixtures.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createGameServer } from '../dist/server.mjs';
import { stopActor } from '../dist/shared/combat.mjs';
const { chromium } =
  await import('file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const out = 'output/playwright/shadow-repair-2026-09-21';
await mkdir(out, { recursive: true });
const baseline = await readFile(`${out}/performance-lod-before.js`, 'utf8');
const game = createGameServer({ host: '127.0.0.1', port: 0 });
const { port } = await game.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [],
  records = [],
  benchmarks = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.route('**/src/shadow-baseline.js', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: baseline }),
  );
  await page.route('**/src/world3d.js', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body:
        (await response.text()) +
        '\nconst originalShadowRender=WorldRenderer.prototype.render;WorldRenderer.prototype.render=function(...args){window.shadowReview=this;window.shadowThree=THREE;return originalShadowRender.apply(this,args);};',
    });
  });
  await page.goto(`http://127.0.0.1:${port}/?room=SHADOWFIX`);
  await page.locator('#title-start').click();
  await page.locator('#setup-form .character-choice:has(input[value="cro-male"])').click();
  await page.locator('#setup-flow [data-choose-difficulty="normal"]').click();
  await page.locator('#setup-flow-yes').click();
  await page.waitForSelector('#world[data-world-asset="ready"][data-character-asset="ready"]', {
    timeout: 120000,
  });
  const room = game.rooms.get('SHADOWFIX');
  room.enemies = [];
  const animal = room.animals.find((a) => a.id === 'mammoth-1');
  stopActor(animal);
  Object.assign(animal, { facing: 0, nextRoam: animal.age + 600, clip: 'Idle_Loop' });
  const player = [...room.players.values()][0];
  stopActor(player);
  Object.assign(player, { x: animal.x + animal.radius + 0.7, z: animal.z });
  await page.waitForFunction(
    ({ x, z }) => {
      const r = shadowReview,
        p = r.players.get(r.selfId);
      return p && Math.hypot(p.model.position.x - x, p.model.position.z - z) < 0.25;
    },
    { x: player.x, z: player.z },
  );
  await page.locator('#world').focus();
  await page.keyboard.press('r');
  await page.waitForFunction(
    () => shadowReview.players.get(shadowReview.selfId)?.state.mountId === 'mammoth-1',
  );
  await page.keyboard.down('w');
  await page.waitForFunction(
    () => shadowReview.mammoths.find((a) => a.id === 'mammoth-1')?.actor.name === 'Walk_Loop',
  );
  await sleep(750);
  await page.screenshot({ path: `${out}/mounted-walk.png` });
  await page.keyboard.press('Shift');
  await page.waitForFunction(
    () => shadowReview.mammoths.find((a) => a.id === 'mammoth-1')?.actor.name === 'Run_Loop',
  );
  await sleep(750);
  await page.screenshot({ path: `${out}/mounted-run.png` });
  await page.keyboard.up('w');
  await page.waitForFunction(
    () => shadowReview.mammoths.find((a) => a.id === 'mammoth-1')?.actor.name === 'Idle_Loop',
  );
  await page.keyboard.press('r');
  await page.waitForFunction(() => !shadowReview.players.get(shadowReview.selfId)?.state.mountId);
  await page.screenshot({ path: `${out}/dismounted.png` });
  Object.assign(player, { x: animal.x + 6, z: animal.z + 6 });
  await sleep(1300);
  const environment = await page.evaluate(async () => {
    const r = shadowReview,
      T = shadowThree;
    cancelAnimationFrame(r.frame);
    window.shadowLOD = await import('/src/performance-lod.js');
    const old = await import('/src/shadow-baseline.js');
    const m = r.mammoths.find((a) => a.id === 'mammoth-1');
    window.shadowTarget = m;
    window.shadowOriginalMammoth = m;
    window.shadowStage = new T.Group();
    shadowStage.position.copy(m.model.position);
    r.scene.add(shadowStage);
    window.shadowOldRoot = new T.Group();
    old.configureActorPerformance(shadowOldRoot, null, m.actor.asset);
    window.shadowBox = shadowOldRoot.userData.actorDetail.proxy;
    m.actor.root.add(shadowBox);
    shadowBox.visible = false;
    window.shadowPose = (actor, clip, phase) => {
      actor.stop();
      actor.sampleOnce(
        clip,
        phase *
          r.worldAssets.get(actor.asset.modelKey).gltf.animations.find((c) => c.name === clip)
            .duration,
      );
      actor.root.updateMatrixWorld(true);
    };
    window.shadowSet = (mode, distance) => {
      const { actor, model } = shadowTarget,
        p = model.position;
      const v = new T.Vector3(9, 5.5, 11).setLength(distance);
      r.camera.position.copy(p).add(v);
      r.camera.lookAt(p.x, p.y + actor.asset.heightMetres * model.scale.y * 0.55, p.z);
      r.camera.updateMatrixWorld(true);
      shadowLOD.updateActorPerformance(actor.root, distance);
      shadowBox.visible = mode === 'box';
      if (mode === 'box')
        for (const entry of actor.root.userData.actorDetail.meshes) {
          entry.mesh.castShadow = false;
          if (entry.shadow) entry.shadow.visible = false;
        }
      r.scene.updateMatrixWorld(true);
      r.renderer.render(r.scene, r.camera);
    };
    shadowPose(m.actor, 'Idle_Loop', 0.37);
    const gl = r.renderer.getContext(),
      ext = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      viewport: [1280, 800],
      shadowMap: r.sun.shadow.mapSize.toArray(),
    };
  });
  for (const distance of [14, 24, 31, 36, 15]) {
    const state = await page.evaluate((distance) => {
      shadowSet('fixed', distance);
      const r = shadowReview,
        d = shadowTarget.actor.root.userData.actorDetail;
      return {
        distance,
        visibleLevel: d.level,
        shadowLevel: d.shadowLevel,
        bodyCasters: d.meshes.filter((e) => e.mesh.castShadow).length,
        lowCasters: d.meshes.filter((e) => e.shadow?.visible).length,
        triangles: r.renderer.info.render.triangles,
        calls: r.renderer.info.render.calls,
      };
    }, distance);
    if (distance === 36) assert.equal(state.bodyCasters + state.lowCasters, 0);
    else assert.ok(state.bodyCasters + state.lowCasters > 0);
    assert.ok(!state.bodyCasters || !state.lowCasters, 'only one source casts the shadow');
    records.push(state);
    await page.screenshot({ path: `${out}/mammoth-distance-${distance}.png` });
  }
  for (const distance of [14, 24]) {
    for (const mode of ['box', 'fixed']) {
      await page.evaluate(({ mode, distance }) => shadowSet(mode, distance), { mode, distance });
      await page.screenshot({ path: `${out}/mammoth-${distance}-${mode}.png` });
    }
    for (const mode of ['box', 'fixed', 'fixed', 'box']) {
      const sample = await page.evaluate(
        async ({ mode, distance }) => {
          shadowSet(mode, distance);
          const r = shadowReview,
            gl = r.renderer.getContext(),
            ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
          const cpu = [],
            interval = [],
            queries = [];
          let previous;
          for (let i = 0; i < 140; i++) {
            const t = await new Promise(requestAnimationFrame);
            if (i >= 20 && previous !== undefined) interval.push(t - previous);
            previous = t;
            const q = ext && i >= 20 ? gl.createQuery() : null;
            if (q) gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
            const start = performance.now();
            r.renderer.render(r.scene, r.camera);
            const elapsed = performance.now() - start;
            if (q) {
              gl.endQuery(ext.TIME_ELAPSED_EXT);
              queries.push(q);
            }
            if (i >= 20) cpu.push(elapsed);
          }
          if (queries.length)
            for (
              let i = 0;
              i < 100 && !gl.getQueryParameter(queries.at(-1), gl.QUERY_RESULT_AVAILABLE);
              i++
            )
              await new Promise((r) => setTimeout(r, 20));
          const gpu = [];
          const disjoint = ext ? gl.getParameter(ext.GPU_DISJOINT_EXT) : false;
          for (const q of queries) {
            if (!disjoint && gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE))
              gpu.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
            gl.deleteQuery(q);
          }
          return {
            mode,
            distance,
            cpuMs: cpu,
            frameIntervalsMs: interval,
            gpuMs: gpu,
            gpuDisjoint: disjoint,
            triangles: r.renderer.info.render.triangles,
            calls: r.renderer.info.render.calls,
          };
        },
        { mode, distance },
      );
      benchmarks.push(sample);
    }
    console.log(`Compared and measured mammoth shadows at ${distance} m.`);
  }
  await page.evaluate(() => {
    shadowBox.removeFromParent();
    shadowBox.geometry.dispose();
    shadowBox.material.dispose();
    shadowBox.visible = false;
  });
  for (const key of ['woolly-mammoth', 'sabertooth-tiger', 'violet-behemoth']) {
    const clips = await page.evaluate(async (key) => {
      const r = shadowReview,
        m = shadowOriginalMammoth;
      m.model.visible = key === 'woolly-mammoth';
      if (key === 'woolly-mammoth') window.shadowTarget = m;
      else {
        const actor = await r.worldAssets.createEnemy(key);
        shadowStage.add(actor.root);
        shadowStage.scale.setScalar(key === 'violet-behemoth' ? 1.35 : 1);
        window.shadowTarget = { actor, model: shadowStage };
      }
      return r.worldAssets
        .get(key)
        .gltf.animations.filter((c) => /^(Idle_Loop|Walk_Loop|Run_Loop|Attack|Death)$/.test(c.name))
        .map((c) => c.name);
    }, key);
    for (const clip of clips)
      for (const distance of [14, 24]) {
        await page.evaluate(
          ({ clip, distance }) => {
            shadowPose(shadowTarget.actor, clip, 0.37);
            shadowSet('fixed', distance);
          },
          { clip, distance },
        );
        await page.screenshot({ path: `${out}/${key}-${clip}-${distance}.png` });
      }
    if (key !== 'woolly-mammoth')
      await page.evaluate(() => {
        shadowTarget.actor.root.removeFromParent();
        shadowTarget.actor.dispose();
      });
  }
  await page.evaluate(() => {
    shadowOriginalMammoth.model.visible = true;
    shadowTarget = shadowOriginalMammoth;
    shadowPose(shadowTarget.actor, 'Idle_Loop', 0.37);
    shadowSet('fixed', 14);
  });
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => {
      shadowReview.resize();
      shadowSet('fixed', 14);
    });
    await page.screenshot({ path: `${out}/viewport-${viewport.width}.png` });
  }
  assert.deepEqual(errors, []);
  const stats = (values) => {
    const a = [...values].sort((a, b) => a - b);
    return a.length
      ? {
          samples: a.length,
          median: a[Math.floor(a.length * 0.5)],
          p95: a[Math.floor(a.length * 0.95)],
          max: a.at(-1),
        }
      : null;
  };
  const summary = [];
  for (const distance of [14, 24])
    for (const mode of ['box', 'fixed']) {
      const samples = benchmarks.filter((s) => s.distance === distance && s.mode === mode);
      summary.push({
        distance,
        mode,
        cpuMs: stats(samples.flatMap((s) => s.cpuMs)),
        gpuMs: stats(samples.flatMap((s) => s.gpuMs)),
        frameIntervalsMs: stats(samples.flatMap((s) => s.frameIntervalsMs)),
        triangles: samples[0].triangles,
        calls: samples[0].calls,
      });
    }
  await writeFile(
    `${out}/report.json`,
    JSON.stringify(
      {
        status: 'passed',
        environment,
        records,
        summary,
        benchmarks,
        errors,
        gameplay:
          'Normal start, R mount, W walk, Shift run, stop, R dismount. Player/roaming coordinates prepared only in a disposable in-memory world.',
        comparison:
          'One frozen frame and camera per distance. Old box versus new silhouette for one mammoth; all other scene content fixed. ABBA order, 20 warmup + 120 measured frames/run, two runs per mode. CPU is renderer submission only; GPU uses disjoint timer queries if available. Not a whole-game or multiplayer benchmark.',
      },
      null,
      2,
    ) + '\n',
  );
  console.log(JSON.stringify({ out, summary, errors }));
} finally {
  await browser.close();
  await game.close();
}
