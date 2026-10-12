// Preserve the former per-model follow, bridge-floor and near/far rendering checks.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { BRIDGE } from '../dist/shared/scenery-layout.mjs';
import { mascotQA, sleep, distance } from './qa-mascot-harness.mjs';

export async function runMascotSurfaces({
  out,
  keys = ['524', 'rimo-neko', 'mae', 'maruimo-mascot'],
} = {}) {
  const q = await mascotQA({ out, retained: true, touch: false });
  let error;
  try {
    const owner = await q.open('owner');
    for (let i = 0; i < 4; i++) await q.peer('peer-' + i);
    q.room().enemies = [];
    let site;
    for (let x = 40; x < 67 && !site; x++)
      for (let z = 55; z < 70; z++)
        if (q.room().collision.free({ x, z }, 4)) {
          site = { x, z };
          break;
        }
    assert.ok(site, 'unobstructed walking stage');
    for (const key of keys) {
      await q.stage(owner, { ...site, facing: 0 });
      const c = await q.choose(owner, key);
      await owner.page.evaluate(() => {
        qa.yaw = 0;
        qa.pitch = 0.25;
        qa.targetDistance = 5;
      });
      const before = { x: owner.player().x, z: owner.player().z };
      await owner.page.locator('#world').focus();
      await owner.page.keyboard.down('w');
      await sleep(1100);
      await owner.page.keyboard.up('w');
      await sleep(1800);
      const moved = distance(owner.player(), before);
      q.records.push({
        key,
        before,
        after: { x: owner.player().x, z: owner.player().z },
        moved,
        messages: owner.seen.sent.filter((m) => m.type === 'move').slice(-5),
      });
      assert.ok(moved > 1, `actual W moves the owner: ${moved}m`);
      assert.ok(distance(owner.player(), c) < 3.5, key + ' follows');
      q.pass(key + ': follows actual movement, then settles near its owner');
      const levels = [];
      // The fixed lightweight profile halves authored LOD distances. For the 30cm
      // 524, the near level returns below 1.4m, not at the former 3m camera zoom.
      for (const targetDistance of [2, 18, 2]) {
        await owner.page.evaluate((d) => {
          qa.targetDistance = d;
          qa.yaw = 0;
          qa.pitch = 0.1;
        }, targetDistance);
        await sleep(1500);
        const sample = await owner.page.evaluate((id) => {
          const r = qa.companionRenderers.renderers.get(id);
          return {
            visible: r.root.visible,
            level: r.actor.root.userData.actorDetail?.level,
            hasLOD: (r.actor.asset.lods?.length ?? 0) > 0,
            distance: r.root.position.distanceTo(qa.camera.position),
            threshold: r.actor.root.userData.actorLodDistance * 0.5,
            targetDistance: qa.targetDistance,
            camera: qa.camera.position.toArray(),
            position: r.root.position.toArray(),
          };
        }, c.id);
        assert.ok(sample.visible);
        levels.push(sample);
      }
      q.records.push({ key, levels });
      if (levels[0].hasLOD)
        assert.deepEqual(
          levels.map((s) => s.level),
          [0, 1, 0],
        );
      q.pass(key + ': near/far/near remains visible and restores the near mesh');
      if (key !== '524') {
        await q.stage(owner, { x: BRIDGE.x - 0.7, z: BRIDGE.z, facing: Math.PI / 2 });
        Object.assign(c, { x: BRIDGE.x - 2.5, z: BRIDGE.z, path: [], velocityX: 0, velocityZ: 0 });
        const proxy = q.room().orbBots.find((b) => b.companionId === c.id);
        if (proxy) Object.assign(proxy, { x: c.x, z: c.z, path: [] });
        await owner.page.evaluate(() => {
          qa.targetDistance = 5;
          qa.yaw = 0;
        });
        await sleep(500);
        await q.record(c, owner);
        await owner.page.locator('#world').focus();
        await owner.page.keyboard.down('d');
        await sleep(1000);
        await owner.page.keyboard.up('d');
        await sleep(1400);
        const samples = await q.frames(owner);
        assert.ok(c.x > BRIDGE.x - 1.7, key + ' crosses the bridge');
        assert.ok(
          samples.some((f) => Math.abs(f.floor - 0.3) < 1e-5),
          'uses bridge floor',
        );
        assert.ok(
          samples.every((f) => Math.abs(f.position[1] - f.floor - 0.002) < 1e-5),
          'body follows the authoritative floor',
        );
        q.records.push({ key, bridge: samples });
        await q.snapshot(key + '-bridge');
        q.pass(key + ': actual follow crosses the bridge with its body aligned to the floor');
      }
      await q.choose(owner, null);
    }
    assert.deepEqual(q.errors, []);
  } catch (caught) {
    error = caught;
    await q.snapshot('failure').catch(() => {});
  } finally {
    await q.finish(error);
  }
  if (error) throw error;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await runMascotSurfaces({ out: process.argv[2] });
