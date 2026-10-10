// Packed world templates: every level of a static template in one verified GLB,
// scene i being level i. Synthetic, test-only models (glb-fixtures.mjs) decoded by
// three r185's own GLTFLoader through the runtime loader; only the browser's image
// decoding is a stand-in (decodeImages).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { WorldAssets, loadVerifiedGLB } from '../dist/src/world-assets.js';
import { LOAD_TIER, LoadTicket } from '../dist/src/asset-load-queue.js';
import {
  WEBP,
  compressedModel,
  decodeImages,
  deferred,
  firstMesh,
  reachable,
  record,
  serve,
  settle,
  sha,
} from './glb-fixtures.mjs';

const DISTANCES = [18, 60];

/** The fixture triangle packed as `scenes` levels: scene L holds node "L<L>" at
 * x = 10·L with its own mesh, accessors, material ("level L") and texture entry,
 * all of the one embedded image. Level 2's texture has a second, identical
 * sampler, so GLTFLoader gives it a Texture of its own for the same image. */
function packedModel({ scenes = 3, change = () => {} } = {}) {
  return compressedModel({
    change(json) {
      const [position, index] = json.accessors,
        [texture] = json.textures,
        levels = [...Array(scenes).keys()];
      json.samplers = [{}, {}];
      json.accessors = levels.flatMap(() => [{ ...position }, { ...index }]);
      json.textures = levels.map((level) => ({ ...texture, sampler: level === 2 ? 1 : 0 }));
      json.materials = levels.map((level) => ({
        name: `level ${level}`,
        pbrMetallicRoughness: { baseColorTexture: { index: level } },
      }));
      json.meshes = levels.map((level) => ({
        primitives: [
          { attributes: { POSITION: 2 * level }, indices: 2 * level + 1, material: level },
        ],
      }));
      json.nodes = levels.map((level) => ({
        name: `L${level}`,
        mesh: level,
        translation: [10 * level, 0, 0],
      }));
      json.scenes = levels.map((level) => ({ nodes: [level] }));
      change(json);
    },
  });
}

/** A catalog record whose `levels` levels all name `url` and their own scene. */
function packedRecord(glb, { key = 'snow', kind = 'terrain', url = '/snow.glb', levels = 3 } = {}) {
  const file = record(url, glb);
  return {
    modelKey: key,
    kind,
    environment: true,
    onDemand: true,
    ...file,
    scene: 0,
    lods: [...Array(levels - 1).keys()].map((index) => ({
      ...file,
      scene: index + 1,
      distanceMetres: DISTANCES[index] ?? 120,
      purpose: `LOD ${index + 1}`,
    })),
  };
}

function world(assets, options) {
  const provider = new WorldAssets(options);
  provider.catalog = { status: 'ready', assets };
  return provider;
}

/** The runtime loader, keeping each model it returns. */
function keeping(parsed, calls = []) {
  return async (file) => {
    calls.push(file.url);
    const model = await loadVerifiedGLB(file);
    parsed.push(model);
    return model;
  };
}

/** dispose() calls per geometry or material from here on. */
function disposals(t) {
  const geometry = t.mock.method(THREE.BufferGeometry.prototype, 'dispose'),
    material = t.mock.method(THREE.Material.prototype, 'dispose');
  return (resource) =>
    [...geometry.mock.calls, ...material.mock.calls].filter((call) => call.this === resource)
      .length;
}

/** Every geometry and material in every scene a parse made. */
function resourcesOf(model) {
  const found = new Set();
  for (const scene of model.scenes)
    scene.traverse((node) => {
      if (node.geometry) found.add(node.geometry);
      for (const material of [node.material].flat()) if (material) found.add(material);
    });
  return found;
}

const meshOf = (root) => root.getObjectByProperty('isMesh', true);

test('a packed template downloads and parses once; each level is its own scene, material and geometry', async (t) => {
  const bitmaps = decodeImages(t),
    disposed = disposals(t),
    raws = [],
    parseAsync = GLTFLoader.prototype.parseAsync;
  t.mock.method(GLTFLoader.prototype, 'parseAsync', async function (...args) {
    const gltf = await parseAsync.apply(this, args);
    raws.push(gltf);
    return gltf;
  });
  const { glb } = await packedModel(),
    requests = serve(t, { '/snow.glb': glb }),
    parsed = [],
    calls = [];
  const assets = world([packedRecord(glb)], { loadEnvironment: keeping(parsed, calls) });
  const [template, joined] = await Promise.all([
    assets.ensureEnvironment('snow'),
    assets.ensureEnvironment('snow'),
  ]);
  assert.equal(joined, template);
  assert.equal(await assets.ensureEnvironment('snow'), template, 'kept, not loaded again');
  assert.deepEqual(calls, ['/snow.glb'], 'one loader call');
  assert.deepEqual(requests, ['/snow.glb'], 'one download');
  assert.equal(raws.length, 1, 'one parse');
  // The template keeps neither the parser nor the GLB body.
  const { parser } = raws[0];
  assert.deepEqual(
    [...reachable(template, [parser, parser.json, parser.extensions.KHR_binary_glTF.body])],
    [],
  );
  // Level i is scene i of the one parse, alone.
  const [model] = parsed,
    levels = [template.gltf, ...template.lods];
  assert.equal(levels.length, 3);
  levels.forEach((level, index) => {
    assert.equal(level.isRuntimeGLTF, true);
    assert.equal(level.scene, model.scenes[index]);
    assert.equal(level.scenes.length, 1);
    assert.equal(level.scenes[0], level.scene);
    assert.equal(meshOf(level.scene).name, `L${index}`);
  });
  const meshes = levels.map(firstMesh);
  assert.deepEqual(
    meshes.map((mesh) => mesh.material.name),
    ['level 0', 'level 1', 'level 2'],
  );
  assert.equal(new Set(meshes.map((mesh) => mesh.geometry)).size, 3);
  assert.ok(meshes.every((mesh) => mesh.castShadow && mesh.receiveShadow));
  // One cohort texture: level 2's own Texture of the same image was coalesced away,
  // and the image was decoded once.
  assert.equal(new Set(meshes.map((mesh) => mesh.material.map)).size, 1);
  assert.equal(meshes[0].material.map.userData.embeddedSha256, sha(WEBP));
  assert.deepEqual(
    bitmaps.map((bitmap) => bitmap.closed),
    [0],
  );
  // Each level's material is its own: changing one changes no other level.
  meshes[1].material.color.setRGB(1, 0, 0);
  assert.deepEqual(
    meshes.map((mesh) => mesh.material.color.getHex()),
    [0xffffff, 0xff0000, 0xffffff],
  );
  // create() and the LOD object select the recorded levels at their distances.
  for (const level of [0, 1, 2]) {
    const mesh = meshOf(assets.create('snow', level));
    assert.equal(mesh.name, `L${level}`);
    assert.equal(mesh.position.x, 10 * level);
    assert.equal(mesh.geometry, meshes[level].geometry);
  }
  assert.throws(() => assets.create('snow', 3), /Missing verified LOD 3 for snow/);
  assert.deepEqual(
    assets
      .createResource('snow')
      .levels.map(({ distance, object }) => [distance, meshOf(object).name]),
    [
      [0, 'L0'],
      [18, 'L1'],
      [60, 'L2'],
    ],
  );
  // Releasing the template releases every level of the file once.
  const resources = resourcesOf(model);
  assert.equal(resources.size, 6);
  assets.releaseEnvironment('snow');
  assert.equal(assets.templates.has('snow'), false);
  assert.ok([...resources].every((resource) => disposed(resource) === 1));
  assert.deepEqual(
    bitmaps.map((bitmap) => bitmap.closed),
    [1],
  );
  assets.dispose();
});

test('a withdrawn packed request starts nothing; later requests load the one file once each', async (t) => {
  decodeImages(t);
  const { glb } = await packedModel(),
    requests = serve(t, { '/snow.glb': glb }),
    blockers = [],
    calls = [];
  const assets = world(
    [
      packedRecord(glb),
      ...['a', 'b'].map((key) => ({ modelKey: key, environment: true, onDemand: true, lods: [] })),
    ],
    {
      loadEnvironment(file) {
        if (file.url) return keeping([], calls)(file);
        const blocker = deferred();
        blockers.push(blocker);
        return blocker.promise;
      },
    },
  );
  // Both queue slots are busy, so the packed load waits, and is withdrawn.
  const held = ['a', 'b'].map((key) => assets.ensureEnvironment(key)),
    ticket = LoadTicket.of(LOAD_TIER.scene),
    withdrawn = assets.ensureEnvironment('snow', ticket);
  ticket.release();
  await assert.rejects(withdrawn, /Asset load cancelled/);
  for (const blocker of blockers) blocker.resolve({ scene: new THREE.Group() });
  await Promise.all(held);
  assert.deepEqual(calls, []);
  assert.deepEqual(requests, []);
  const template = await assets.ensureEnvironment('snow');
  assert.deepEqual(calls, ['/snow.glb']);
  assets.releaseEnvironment('snow');
  const again = await assets.ensureEnvironment('snow');
  assert.notEqual(again, template, 'released, then loaded again');
  assert.deepEqual(calls, ['/snow.glb', '/snow.glb']);
  assert.deepEqual(requests, ['/snow.glb', '/snow.glb']);
  assets.dispose();
});

test('disposed while its packed file downloads, the provider releases the late parse whole', async (t) => {
  const bitmaps = decodeImages(t),
    disposed = disposals(t),
    gate = deferred(),
    { glb } = await packedModel(),
    requests = serve(t, {
      '/snow.glb': async () => {
        await gate.promise;
        return new Response(glb);
      },
    }),
    parsed = [];
  const assets = world([packedRecord(glb)], { loadEnvironment: keeping(parsed) });
  const loading = assets.ensureEnvironment('snow');
  while (!requests.length) await settle();
  assets.dispose();
  gate.resolve();
  await assert.rejects(loading, /World assets disposed/);
  assert.equal(parsed.length, 1, 'the parse finished after disposal');
  assert.equal(assets.templates.size, 0);
  assert.ok([...resourcesOf(parsed[0])].every((resource) => disposed(resource) === 1));
  assert.deepEqual(
    bitmaps.map((bitmap) => bitmap.closed),
    [1],
  );
});

test('packed metadata that does not map every level to its own scene of one file is refused before any request', async (t) => {
  const { glb } = await packedModel(),
    requests = serve(t, { '/snow.glb': glb, '/other.glb': glb });
  const cases = [
    ['a level without a scene', (r) => delete r.lods[1].scene, /2 of its 3 levels name a scene/],
    [
      'the full model naming scene 1',
      (r) => (r.scene = 1),
      /level 0 names scene 1; packed level 0 is scene 0/,
    ],
    [
      'LODs in the wrong order',
      (r) => {
        r.lods[0].scene = 2;
        r.lods[1].scene = 1;
      },
      /level 1 names scene 2; packed level 1 is scene 1/,
    ],
    ['a scene named twice', (r) => (r.lods[1].scene = 1), /levels 1 and 2 both name scene 1/],
    [
      'a scene that is not an index',
      (r) => (r.lods[0].scene = '1'),
      /level 1 names scene "1", not a scene index/,
    ],
    ['another URL', (r) => (r.lods[0].url = '/other.glb'), /level 1 is not the file level 0 names/],
    [
      'another SHA-256',
      (r) => (r.lods[1].sha256 = sha(Buffer.from('another file'))),
      /level 2 is not the file level 0 names/,
    ],
    ['another length', (r) => (r.lods[0].bytes += 4), /level 1 is not the file level 0 names/],
    [
      'parts on one level only',
      (r) => (r.parts = [record('/snow.glb', glb)]),
      /level 1 is not the file level 0 names/,
    ],
    [
      'an animated actor kind',
      (r) => (r.kind = 'quadruped'),
      /a quadruped cannot have packed levels/,
    ],
  ];
  for (const [name, change, refusal] of cases) {
    const packed = packedRecord(glb),
      progress = [];
    change(packed);
    const assets = world([packed], {
      loadEnvironment: () => assert.fail(`${name}: nothing is loaded`),
    });
    await assert.rejects(assets.ensureEnvironment('snow'), refusal, name);
    await assert.rejects(
      assets.loadStartup(['snow'], { onProgress: (...report) => progress.push(report) }),
      refusal,
      `${name}: startup`,
    );
    assert.deepEqual(progress, [], `${name}: refused before any progress`);
    assert.equal(assets.templates.size, 0);
    assets.dispose();
  }
  assert.deepEqual(requests, []);
});

test('enemy and equipment records with scene levels are refused, never read from scene 0', async (t) => {
  const { glb } = await packedModel(),
    requests = serve(t, { '/snow.glb': glb });
  const assets = world([
    packedRecord(glb, { key: 'crow-shaman', kind: 'enemy' }),
    packedRecord(glb, { key: 'wooden-spear', kind: 'equipment', levels: 1 }),
  ]);
  await assert.rejects(
    assets.createEnemy('crow-shaman'),
    /crow-shaman: enemy templates cannot have packed levels/,
  );
  await assert.rejects(
    assets.ensureEquipment('wooden-spear'),
    /wooden-spear: equipment templates cannot have packed levels/,
  );
  assert.deepEqual(requests, []);
  assert.equal(assets.templates.size, 0);
  assets.dispose();
});

test('a packed file whose scenes do not hold its levels apart is refused after its one parse and released whole', async (t) => {
  const bitmaps = decodeImages(t),
    disposed = disposals(t),
    files = {},
    requests = serve(t, files);
  const cases = [
    ['an extra scene', { scenes: 4 }, 3, /snow: has 4 scenes for 3 packed levels/],
    ['a missing scene', { scenes: 2 }, 3, /snow: has 2 scenes for 3 packed levels/],
    [
      'another default scene',
      { change: (json) => (json.scene = 1) },
      3,
      /with scene 0 the default/,
    ],
    [
      'levels sharing one mesh',
      { change: (json) => json.nodes.forEach((node) => (node.mesh = 0)) },
      3,
      /snow: scenes 0 and 1 share geometry/,
    ],
    [
      'levels sharing one material',
      { change: (json) => json.meshes.forEach((mesh) => (mesh.primitives[0].material = 0)) },
      3,
      /snow: scenes 0 and 1 share a material/,
    ],
  ];
  for (const [name, fixture, levels, refusal] of cases) {
    const { glb } = await packedModel(fixture),
      seen = { bitmaps: bitmaps.length, requests: requests.length },
      parsed = [];
    files['/snow.glb'] = glb;
    const assets = world([packedRecord(glb, { levels })], { loadEnvironment: keeping(parsed) });
    await assert.rejects(assets.ensureEnvironment('snow'), refusal, name);
    assert.equal(requests.length - seen.requests, 1, `${name}: one download`);
    assert.equal(parsed.length, 1, `${name}: one parse`);
    assert.ok(
      [...resourcesOf(parsed[0])].every((resource) => disposed(resource) === 1),
      `${name}: every geometry and material of every scene is released once`,
    );
    const decoded = bitmaps.slice(seen.bitmaps);
    assert.ok(decoded.length && decoded.every((bitmap) => bitmap.closed === 1), name);
    assert.equal(assets.templates.size, 0);
    assert.equal(assets.loadQueue.active, 0);
    assets.dispose();
  }
});

test('animated or skinned packed content is refused after the parse and released', async (t) => {
  const bitmaps = decodeImages(t),
    files = {},
    requests = serve(t, files);
  const unskin = (json) => {
    delete json.skins;
    delete json.nodes[0].skin;
    const { attributes } = json.meshes[0].primitives[0];
    delete attributes.JOINTS_0;
    delete attributes.WEIGHTS_0;
  };
  const cases = [
    ['a clip and a skin', () => {}, /rig: packed levels cannot be animated/],
    ['a skin', (json) => delete json.animations, /rig: scene 0 is skinned/],
    ['a clip', unskin, /rig: packed levels cannot be animated/],
  ];
  for (const [name, change, refusal] of cases) {
    // The rig fixture: scene 0 the weighted "Body" and its "Bone", scene 1 "Second".
    const { glb } = await compressedModel({ rig: true, change }),
      seen = bitmaps.length;
    files['/rig.glb'] = glb;
    const assets = world([
      packedRecord(glb, { key: 'rig', kind: 'static', url: '/rig.glb', levels: 2 }),
    ]);
    await assert.rejects(assets.ensureEnvironment('rig'), refusal, name);
    const decoded = bitmaps.slice(seen);
    assert.equal(decoded.length, 2, `${name}: both scenes were parsed`);
    assert.ok(
      decoded.every((bitmap) => bitmap.closed === 1),
      `${name}: released once`,
    );
    assert.equal(assets.templates.size, 0);
    assets.dispose();
  }
  assert.equal(requests.length, cases.length);
});

test('an ordinary template still loads one verified file per level, in order', async (t) => {
  const bitmaps = decodeImages(t),
    { glb } = await compressedModel(),
    requests = serve(t, { '/stone.glb': glb, '/stone-1.glb': glb, '/stone-2.glb': glb });
  const assets = world([
    {
      modelKey: 'stone',
      kind: 'static',
      environment: true,
      onDemand: true,
      ...record('/stone.glb', glb),
      lods: [record('/stone-1.glb', glb), record('/stone-2.glb', glb)],
    },
  ]);
  const template = await assets.ensureEnvironment('stone');
  assert.deepEqual(requests, ['/stone.glb', '/stone-1.glb', '/stone-2.glb']);
  const levels = [template.gltf, ...template.lods];
  assert.equal(new Set(levels.map((level) => level.scene)).size, 3);
  // Its LODs take the full model's texture and close their own images.
  assert.equal(new Set(levels.map((level) => firstMesh(level).material.map)).size, 1);
  assert.deepEqual(
    bitmaps.map((bitmap) => bitmap.closed),
    [0, 1, 1],
  );
  assets.dispose();
  assert.deepEqual(
    bitmaps.map((bitmap) => bitmap.closed),
    [1, 1, 1],
  );
});

test('startup progress counts a packed file once and each ordinary level file', async (t) => {
  decodeImages(t);
  const packed = (await packedModel()).glb,
    plain = (await compressedModel()).glb,
    requests = serve(t, { '/snow.glb': packed, '/stone.glb': plain, '/stone-1.glb': plain });
  const assets = world([
    packedRecord(packed),
    {
      modelKey: 'stone',
      kind: 'static',
      ...record('/stone.glb', plain),
      lods: [record('/stone-1.glb', plain)],
    },
  ]);
  const progress = [],
    total = packed.length + 2 * plain.length;
  await assets.loadStartup(['snow', 'stone'], {
    onProgress: (loaded, size) => progress.push([loaded, size]),
  });
  assert.equal(progress.length, 3);
  assert.deepEqual(progress[0], [0, total]);
  assert.ok([packed.length, 2 * plain.length].includes(progress[1][0]));
  assert.equal(progress[1][1], total);
  assert.deepEqual(progress[2], [total, total]);
  assert.equal(requests.filter((path) => path === '/snow.glb').length, 1);
  assert.ok(assets.templates.has('snow') && assets.templates.has('stone'));
  assets.dispose();
});
