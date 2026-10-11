// The local server's delivery overlay: synthetic manifests and cache files in a temporary root.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  deliveredAssetJson,
  readDeliveryOverlay,
} from '../dist/infrastructure/node/delivery-overlay.mjs';
import { createGameServer } from '../dist/server.mjs';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cro-overlay-'));
  const master = Buffer.from('master-glb-bytes'),
    lod = Buffer.from('master-lod-bytes'),
    cooked = Buffer.from('cooked-packed-bytes'),
    texture = Buffer.from('master-png'),
    cookedTexture = Buffer.from('cooked-webp');
  const cookedUrl = `/models/rock/model-levels.cook-${sha(cooked).slice(0, 16)}.glb`;
  const textureUrl = `/models/rock/stone.cook-${sha(cookedTexture).slice(0, 16)}.webp`;
  const asset = {
    modelKey: 'rock',
    kind: 'static',
    url: '/models/rock/model.glb',
    sha256: sha(master),
    bytes: master.length,
    lods: [
      { url: '/models/rock/lod1.glb', sha256: sha(lod), bytes: lod.length, distanceMetres: 20 },
    ],
    rockSurface: { url: '/models/rock/stone.png', sha256: sha(texture), bytes: texture.length },
    provenance: { url: '/models/rock/stone.png', sha256: sha(texture) },
  };
  await mkdir(path.join(root, 'public/models/rock'), { recursive: true });
  await mkdir(path.join(root, 'dist/delivery/cache'), { recursive: true });
  await writeFile(
    path.join(root, 'public/models/world-assets.json'),
    JSON.stringify({ assets: [asset] }),
  );
  await writeFile(path.join(root, 'public/models/rock/asset.json'), JSON.stringify(asset));
  await writeFile(path.join(root, 'public/models/rock/model.glb'), master);
  await writeFile(path.join(root, `dist/delivery/cache/${sha(cooked)}.glb`), cooked);
  await writeFile(path.join(root, `dist/delivery/cache/${sha(cookedTexture)}.webp`), cookedTexture);
  const packed = (scene) => ({
    delivery: { url: cookedUrl, sha256: sha(cooked), bytes: cooked.length, scene },
    file: `${sha(cooked)}.glb`,
  });
  await writeFile(
    path.join(root, 'dist/delivery/overlay.json'),
    JSON.stringify({
      schema: 'cro-magnon/delivery-overlay@1',
      models: {
        '/models/rock/model.glb': {
          master: { sha256: sha(master), bytes: master.length },
          ...packed(0),
        },
        '/models/rock/lod1.glb': { master: { sha256: sha(lod), bytes: lod.length }, ...packed(1) },
      },
      textures: {
        '/models/rock/stone.png': {
          master: { sha256: sha(texture), bytes: texture.length },
          delivery: { url: textureUrl, sha256: sha(cookedTexture), bytes: cookedTexture.length },
          file: `${sha(cookedTexture)}.webp`,
        },
      },
    }),
  );
  return { root, asset, cooked, cookedUrl, textureUrl, cookedTexture };
}

test('manifests name the cooked files while their masters are the cooked ones', async () => {
  const { root, asset, cooked, cookedUrl, textureUrl } = await fixture();
  try {
    const overlay = await readDeliveryOverlay(root);
    const out = deliveredAssetJson(asset, overlay);
    assert.equal(out.url, cookedUrl);
    assert.equal(out.scene, 0);
    assert.equal(out.bytes, cooked.length);
    assert.equal(out.lods[0].url, cookedUrl);
    assert.equal(out.lods[0].scene, 1);
    assert.equal(out.lods[0].distanceMetres, 20);
    assert.equal(out.rockSurface.url, textureUrl);
    assert.deepEqual(out.provenance, asset.provenance);
    // A level adopted after the overlay was prepared: packed levels stay masters together.
    const changed = { ...asset, lods: [{ ...asset.lods[0], sha256: '0'.repeat(64) }] };
    const kept = deliveredAssetJson(changed, overlay);
    assert.equal(kept.url, asset.url);
    assert.equal(kept.scene, undefined);
    assert.equal(kept.lods[0].url, asset.lods[0].url);
    assert.equal(kept.rockSurface.url, textureUrl, 'the texture is its own record');
    assert.equal(await readDeliveryOverlay(path.join(root, 'missing')), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('the local server sends delivery manifests and files only with an overlay', async () => {
  const { root, cooked, cookedUrl, textureUrl, cookedTexture } = await fixture();
  const servers = [];
  try {
    for (const delivery of [await readDeliveryOverlay(root), null]) {
      const game = createGameServer({ port: 0, host: '127.0.0.1', assetRoot: root, delivery });
      servers.push(game);
      const { port } = await game.listen();
      const base = `http://127.0.0.1:${port}`;
      const catalog = await (await fetch(`${base}/models/world-assets.json`)).json();
      const own = await (await fetch(`${base}/models/rock/asset.json`)).json();
      const file = await fetch(`${base}${cookedUrl}`);
      const image = await fetch(`${base}${textureUrl}`);
      if (delivery) {
        assert.equal(catalog.assets[0].url, cookedUrl);
        assert.equal(own.url, cookedUrl);
        assert.equal(own.lods[0].scene, 1);
        assert.equal(file.status, 200);
        assert.deepEqual(Buffer.from(await file.arrayBuffer()), cooked);
        assert.equal(image.headers.get('content-type'), 'image/webp');
        assert.deepEqual(Buffer.from(await image.arrayBuffer()), cookedTexture);
      } else {
        assert.equal(catalog.assets[0].url, '/models/rock/model.glb');
        assert.equal(file.status, 404);
        assert.equal(image.status, 404);
      }
      // Traversal and dot segments stay refused with or without an overlay.
      assert.equal(
        (await fetch(`${base}/models/..%2F..%2Fdist%2Fdelivery%2Foverlay.json`)).status,
        403,
      );
    }
  } finally {
    for (const game of servers) await game.close();
    await rm(root, { recursive: true, force: true });
  }
});
