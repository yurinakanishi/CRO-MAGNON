// Compare the actual worker output with the existing synchronous fit on both shipped mountain LODs.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createGameServer } from '../dist/server.mjs';
import { localVerificationSettings } from '../dist/infrastructure/node/local-verification.mjs';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const out = process.argv[2] || 'output/playwright/loading-cave-20261007/geometry';
await mkdir(out, { recursive: true });
const game = createGameServer({ ...localVerificationSettings(out), port: 0 });
const { port } = await game.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.locator('#title-start').waitFor();
  const report = await page.evaluate(async () => {
    const THREE = await import('three');
    const { loadVerifiedGLB } = await import('/src/world-assets.js');
    const { prepareMountainRiverBed, prepareMountainRiverBedAsync } =
      await import('/src/mountain-river.js');
    const { RiverBankBuilder } = await import('/src/river-bank-builder.js');
    const asset = await (await fetch('/models/camp-mountain/asset.json')).json();
    const builder = new RiverBankBuilder();
    const hash = async (array) =>
      Array.from(
        new Uint8Array(
          await crypto.subtle.digest(
            'SHA-256',
            new Uint8Array(array.buffer, array.byteOffset, array.byteLength),
          ),
        ),
      )
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    const fingerprint = async (geometry) => {
      const attributes = {};
      for (const name of Object.keys(geometry.attributes).sort()) {
        const a = geometry.attributes[name];
        attributes[name] = {
          count: a.count,
          itemSize: a.itemSize,
          normalized: a.normalized,
          sha256: await hash(a.array),
        };
      }
      return {
        attributes,
        index: geometry.index ? await hash(geometry.index.array) : null,
        groups: geometry.groups,
        drawRange: geometry.drawRange,
      };
    };
    const checks = [];
    try {
      for (const record of [asset, ...asset.lods]) {
        const { scene } = await loadVerifiedGLB(record);
        const reference = scene.clone(true);
        reference.traverse((node) => {
          if (node.isMesh) node.geometry = node.geometry.clone();
        });
        await prepareMountainRiverBedAsync(scene, builder);
        prepareMountainRiverBed(reference);
        const meshes = [],
          originals = [];
        scene.traverse((node) => {
          if (node.isMesh) meshes.push(node.geometry);
        });
        reference.traverse((node) => {
          if (node.isMesh) originals.push(node.geometry);
        });
        for (let i = 0; i < meshes.length; i++) {
          checks.push({
            url: record.url,
            mesh: i,
            worker: await fingerprint(meshes[i]),
            reference: await fingerprint(originals[i]),
          });
          meshes[i].dispose();
          originals[i].dispose();
        }
      }
      // No-op fitting must retain normals, UVs, material groups and the draw range.
      const source = new THREE.PlaneGeometry(2, 2).translate(1000, 1000, 1000);
      source.addGroup(0, 6, 0);
      source.setDrawRange(0, 3);
      const result = await builder.build(source.clone(), {
        maximumEdge: 0.45,
        mountainOnly: false,
      });
      checks.push({
        url: 'no-op',
        worker: await fingerprint(result),
        reference: await fingerprint(source),
      });
      result.dispose();
      source.dispose();
      return checks;
    } finally {
      builder.dispose();
    }
  });
  await writeFile(`${out}/report.json`, JSON.stringify({ report, errors }, null, 2));
  for (const item of report)
    assert.deepEqual(item.worker, item.reference, `${item.url} mesh ${item.mesh}`);
  assert.deepEqual(errors, []);
  console.log(
    `PASS ${report.length} exact geometry comparisons: worker and original positions, normals, UVs, indices and groups`,
  );
} finally {
  await browser.close();
  await game.close();
}
