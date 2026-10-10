// Exact repack building blocks (scripts/optimization/png-idat.mjs, level-pack.mjs) and the build
// graph's packed-level rules (scripts/runtime-graph.mjs). Tiny synthetic fixtures only; the
// adoption flow is tested in runtime-adoption.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { MESHOPT, parseGlb, sha256, storedViewBytes } from '../scripts/optimization/glb.mjs';
import {
  PNG_SIGNATURE,
  checkLosslessRewrite,
  crc32,
  parsePng,
  pngChunk,
  pngIdentity,
  recompressPng,
} from '../scripts/optimization/png-idat.mjs';
import {
  packLevels,
  substituteImages,
  substitutionProblems,
  threeParse,
  threeProblems,
  verifyLevels,
} from '../scripts/optimization/level-pack.mjs';
import { checkRuntimeGraph } from '../scripts/runtime-graph.mjs';
import { CHUNKS, compressedGlb, patternPng, pngFile, sceneGlb } from './exact-repack-fixtures.mjs';

const FAST = Object.freeze({
  level: 9,
  windowBits: 15,
  strategies: ['DEFAULT', 'RLE'],
  memLevels: [9],
});
const SIGNATURE = Buffer.from(PNG_SIGNATURE);
const rawChunks = (bytes) => {
  const parsed = parsePng(bytes, 'probe');
  return parsed.chunks
    .filter((chunk) => chunk.type !== 'IDAT')
    .map((chunk) => bytes.subarray(chunk.start, chunk.end).toString('hex'));
};

test('a lossless IDAT rewrite keeps IHDR, every other chunk and the filtered scanlines, and is offered only when smaller', () => {
  const original = pngFile({
      before: [CHUNKS.sRGB, CHUNKS.gAMA, CHUNKS.cHRM, CHUNKS.eXIf, CHUNKS.oFFs, CHUNKS.pHYs],
      after: [CHUNKS.tEXt],
      idatChunks: 3,
    }),
    outcome = recompressPng(original, 'probe', FAST);
  assert.equal(outcome.status, 'candidate', outcome.reason);
  assert.ok(outcome.candidate.length < original.length);
  assert.deepEqual(parsePng(outcome.candidate, 'candidate').types, [
    'IHDR',
    'sRGB',
    'gAMA',
    'cHRM',
    'eXIf',
    'oFFs',
    'pHYs',
    'IDAT',
    'tEXt',
    'IEND',
  ]);
  assert.deepEqual(
    rawChunks(outcome.candidate),
    rawChunks(original),
    'every non-IDAT chunk byte for byte, in order',
  );
  assert.deepEqual(pngIdentity(outcome.candidate, 'candidate'), pngIdentity(original, 'original'));
  checkLosslessRewrite(original, outcome.candidate, 'probe');
  assert.ok(outcome.record.attempts.every((attempt) => attempt.identical && attempt.exact));
  assert.ok(
    recompressPng(original, 'again', FAST).candidate.equals(outcome.candidate),
    'deterministic',
  );
  // Already the best stream the settings can make: the original is retained, never re-encoded.
  const optimal = pngFile({ level: 9, idatChunks: 1 }),
    kept = recompressPng(optimal, 'optimal', {
      level: 9,
      windowBits: 15,
      strategies: ['DEFAULT'],
      memLevels: [8],
    });
  assert.equal(kept.status, 'original-retained');
  assert.equal(kept.candidate, null);
});

test('a pixel, metadata or filter change is not a lossless rewrite', () => {
  const original = pngFile({ before: [CHUNKS.gAMA], after: [CHUNKS.tEXt] }),
    rejects = (candidate, pattern) =>
      assert.throws(() => checkLosslessRewrite(original, candidate, 'probe'), pattern);
  rejects(
    pngFile({
      before: [CHUNKS.gAMA],
      after: [CHUNKS.tEXt],
      level: 9,
      pixel: (x, y) =>
        x === 3 && y === 4 ? [1, 2, 3, 4] : [(x * 13) & 255, (y * 7) & 255, (x ^ y) & 255, 255],
    }),
    /rawSha256/,
  );
  rejects(
    pngFile({ before: [['gAMA', [0, 0, 0xb1, 0x90]]], after: [CHUNKS.tEXt], level: 9 }),
    /before/,
  );
  rejects(pngFile({ before: [CHUNKS.gAMA], level: 9 }), /after/);
  rejects(pngFile({ before: [CHUNKS.gAMA, CHUNKS.tEXt], level: 9 }), /before|after/);
  // The same pixels filtered differently: the scanline stream is part of the preserved identity.
  rejects(
    pngFile({ before: [CHUNKS.gAMA], after: [CHUNKS.tEXt], level: 9, filter: 1 }),
    /rawSha256/,
  );
});

test('strict PNG validation refuses ambiguous or unsupported input and retains the original', () => {
  const good = pngFile({ after: [CHUNKS.tEXt] }),
    refused = (bytes, pattern) => {
      const outcome = recompressPng(bytes, 'probe', FAST);
      assert.equal(outcome.status, 'rejected-original-retained', String(pattern));
      assert.equal(outcome.candidate, null);
      assert.match(outcome.reason, pattern);
    },
    parsed = parsePng(good, 'good'),
    chunkOf = (type) => parsed.chunks.find((chunk) => chunk.type === type),
    text = chunkOf('tEXt'),
    corrupt = Buffer.from(good);
  corrupt[text.dataStart] ^= 1;
  refused(corrupt, /CRC mismatch in chunk tEXt/);
  refused(Buffer.concat([good, Buffer.from('x')]), /1 bytes after IEND/);
  // Hand-built PNGs around the fixture's IHDR chunk and zlib stream.
  const ihdr = good.subarray(8, 33),
    data = parsePng(pngFile({ idatChunks: 1 }), 'stream').idat,
    half = Math.ceil(data.length / 2),
    build = (...chunks) =>
      Buffer.concat([SIGNATURE, ihdr, ...chunks, pngChunk('IEND', Buffer.alloc(0))]);
  refused(
    build(
      pngChunk('IDAT', data.subarray(0, half)),
      pngChunk('tEXt', Buffer.from('a\0b')),
      pngChunk('IDAT', data.subarray(half)),
    ),
    /IDAT chunks are not contiguous/,
  );
  refused(
    build(pngChunk('ABCD', Buffer.alloc(1)), pngChunk('IDAT', data)),
    /unknown critical chunk ABCD/,
  );
  refused(
    build(pngChunk('abCD', Buffer.alloc(1)), pngChunk('IDAT', data)),
    /unknown unsafe-to-copy chunk abCD/,
  );
  refused(
    build(
      pngChunk('gAMA', Buffer.from(CHUNKS.gAMA[1])),
      pngChunk('gAMA', Buffer.from(CHUNKS.gAMA[1])),
      pngChunk('IDAT', data),
    ),
    /more than one gAMA/,
  );
  refused(
    build(pngChunk('IDAT', data), pngChunk('eXIf', Buffer.from(CHUNKS.eXIf[1]))),
    /eXIf after IDAT/,
  );
  refused(build(pngChunk('acTL', Buffer.alloc(8)), pngChunk('IDAT', data)), /animated PNG/);
  refused(
    build(pngChunk('IDAT', Buffer.concat([data, Buffer.from([1, 2, 3])]))),
    /follow the zlib stream|does not inflate/,
  );
  const wide = Buffer.from(ihdr);
  wide.writeUInt32BE(17, 8);
  wide.writeUInt32BE(crc32(wide.subarray(4, 21)), 21);
  refused(
    Buffer.concat([SIGNATURE, wide, pngChunk('IDAT', data), pngChunk('IEND', Buffer.alloc(0))]),
    /inflates to|does not inflate within/,
  );
  const badFilter = Buffer.from(zlib.inflateSync(data));
  badFilter[0] = 7;
  refused(build(pngChunk('IDAT', zlib.deflateSync(badFilter))), /filter type 7/);
  // An unknown chunk that is safe to copy is kept, byte for byte.
  const safe = build(pngChunk('abCd', Buffer.from('kept')), pngChunk('IDAT', data)),
    kept = recompressPng(safe, 'safe', FAST);
  assert.equal(kept.status, 'candidate', kept.reason);
  assert.deepEqual(rawChunks(kept.candidate), rawChunks(safe));
});

async function levelsOf(specs) {
  const levels = [];
  for (const spec of specs) {
    const bytes = await compressedGlb(sceneGlb(spec), spec.name);
    levels.push({ label: spec.name, bytes, doc: parseGlb(bytes, spec.name) });
  }
  return levels;
}

test('PNG substitution changes only image bytes, offsets and lengths; meshopt streams stay byte for byte', async () => {
  const image = pngFile({ before: [CHUNKS.gAMA], idatChunks: 2 }),
    [level] = await levelsOf([{ name: 'hill', triangles: 256, image }]),
    compressed = level.doc.json.bufferViews
      .map((view, v) => [v, view.extensions?.[MESHOPT]])
      .filter(([, ext]) => ext);
  assert.ok(compressed.length > 0, 'the fixture carries meshopt streams');
  const rewrite = recompressPng(image, 'image', FAST).candidate,
    replacements = new Map([[sha256(image), rewrite]]),
    substituted = substituteImages(level.doc, replacements, 'hill');
  assert.equal(substituted.substituted.length, 1);
  assert.deepEqual(substitutionProblems(level.doc, substituted, replacements, 'hill'), []);
  for (const [v, ext] of compressed) {
    const after = substituted.json.bufferViews[v].extensions[MESHOPT],
      stream = (bin, item) =>
        bin.subarray(item.byteOffset ?? 0, (item.byteOffset ?? 0) + item.byteLength);
    assert.ok(
      stream(substituted.bin, after).equals(stream(level.doc.bin, ext)),
      `view ${v} stream`,
    );
  }
  const imageView = substituted.json.images[0].bufferView;
  assert.ok(storedViewBytes(substituted.json, substituted.bin, imageView).equals(rewrite));
  // A replacement that is not a lossless rewrite is refused before anything is laid out.
  assert.throws(
    () =>
      substituteImages(
        level.doc,
        new Map([[sha256(image), patternPng(9, { before: [CHUNKS.gAMA] })]]),
        'hill',
      ),
    /not a lossless IDAT rewrite/,
  );
  // A changed byte in a meshopt stream is reported.
  const tampered = { json: substituted.json, bin: Buffer.from(substituted.bin) },
    [stream] = compressed[0];
  tampered.bin[substituted.json.bufferViews[stream].extensions[MESHOPT].byteOffset + 1] ^= 1;
  assert.match(
    substitutionProblems(level.doc, tampered, replacements, 'hill').join('\n'),
    new RegExp(`buffer view ${stream} stored bytes changed`),
  );
});

test('packed levels verify scene by scene against the original levels, with lossless-aware image identity and isolated materials', async () => {
  const image = pngFile({ before: [CHUNKS.gAMA], idatChunks: 2 }),
    levels = await levelsOf([
      { name: 'hill', triangles: 256, image },
      { name: 'hill lod', triangles: 64, image },
    ]),
    rewrite = recompressPng(image, 'image', FAST).candidate,
    replacements = new Map([[sha256(image), rewrite]]),
    rewrites = new Map([[sha256(image), sha256(rewrite)]]),
    substitute = (list) =>
      list.map((level) => {
        const result = substituteImages(level.doc, replacements, level.label);
        return { label: level.label, doc: { json: result.json, bin: result.bin } };
      }),
    packed = packLevels(substitute(levels), 'hill');
  assert.equal(packed.report.deduplicatedImageViews.length, 1, 'the shared image is stored once');
  const result = await verifyLevels(packed.bytes, levels, 'hill', { rewrites });
  assert.deepEqual(result.problems, []);
  assert.deepEqual(
    result.scenes.map((scene) => [scene.scene, scene.triangles]),
    [
      [0, 256],
      [1, 64],
    ],
  );
  assert.deepEqual((await threeProblems(packed.bytes, levels, 'hill')).problems, []);
  assert.ok(
    packLevels(substitute(levels), 'hill').bytes.equals(packed.bytes),
    'packing twice is byte-identical',
  );
  const doc = parseGlb(packed.bytes, 'packed');
  assert.deepEqual(
    [doc.json.scenes.length, new Set(doc.json.images.map((item) => item.bufferView)).size],
    [2, 1],
  );
  // Each level keeps its own material: mutating one leaves the other as it was.
  const gltf = await threeParse(packed.bytes, 'packed'),
    materials = gltf.scenes.map((scene) => {
      let material;
      scene.traverse((node) => {
        if (node.isMesh) material = node.material;
      });
      return material;
    });
  assert.notEqual(materials[0], materials[1]);
  const before = materials[1].color.getHex();
  materials[0].color.setHex(0xff0000);
  assert.equal(materials[1].color.getHex(), before);
  // Without the recorded rewrite, the packed image is unexplained and refused.
  assert.match(
    (await verifyLevels(packed.bytes, levels, 'hill')).problems.join('\n'),
    /neither its original nor its recorded rewrite/,
  );
});

test('a changed vertex, transform, image, metadata, scene order or scene count in a packed file is refused', async () => {
  const image = pngFile({ before: [CHUNKS.gAMA] }),
    specs = [
      { name: 'hill', triangles: 256, image },
      { name: 'hill lod', triangles: 64, image },
    ],
    levels = await levelsOf(specs),
    pack = async (changed) =>
      packLevels(
        (await levelsOf(changed)).map(({ label, doc }) => ({ label, doc })),
        'hill',
      ).bytes,
    differs = async (changed, pattern) =>
      assert.match(
        (await verifyLevels(await pack(changed), levels, 'hill')).problems.join('\n'),
        pattern,
      );
  await differs([specs[0], { ...specs[1], offset: 0.5 }], /packed scene 1 differs/);
  await differs([specs[0], { ...specs[1], translation: [0, 1, 0] }], /packed scene 1 differs/);
  await differs([specs[0], { ...specs[1], image: patternPng(5) }], /packed scene 1 differs/);
  await differs(
    [specs[0], { ...specs[1], image: pngFile({ before: [['gAMA', [0, 0, 0xb1, 0x90]]] }) }],
    /packed scene 1 differs/,
  );
  await differs([specs[1], specs[0]], /packed scene 0 differs/);
  assert.match(
    (await verifyLevels(await pack(specs), [...levels, levels[1]], 'hill')).problems.join('\n'),
    /expected exactly 3 scene\(s\), found 2/,
  );
});

test('the build graph accepts a packed template only as adopted: one file, level i in scene i, one physical copy', () => {
  const digest = 'ab'.repeat(32),
    file = {
      url: `/models/hill/model-levels.opt-${digest.slice(0, 16)}.glb`,
      sha256: digest,
      bytes: 100,
    },
    entry = {
      selection: 'ordinary-compressed',
      primary: { ...file, scene: 0 },
      lods: [
        { ...file, scene: 1 },
        { ...file, scene: 2 },
      ],
    },
    adoption = (graphEntry = entry) => ({
      id: 'test-a01',
      planSha256: 'c'.repeat(64),
      graph: { models: { hill: graphEntry }, textures: {}, retired: [], notAdopted: {} },
    }),
    asset = (
      lods = [
        { ...file, scene: 1, distanceMetres: 40 },
        { ...file, scene: 2, distanceMetres: 80 },
      ],
      extra = {},
    ) => ({
      modelKey: 'hill',
      ...file,
      scene: 0,
      triangles: 10,
      runtimeOptimization: { adoption: 'test-a01' },
      lods,
      ...extra,
    }),
    options = { textureRecords: () => [] },
    refused = (assets, pattern, graph = adoption()) =>
      assert.throws(() => checkRuntimeGraph(assets, graph, options), pattern);
  const result = checkRuntimeGraph([asset()], adoption(), options);
  assert.deepEqual(
    result.models.map((model) => model.scene),
    [0, 1, 2],
  );
  assert.deepEqual(result.physicalModels, [{ ...file, records: 3 }]);
  // Tampered scenes with the file's SHA-256 unchanged.
  refused(
    [
      asset([
        { ...file, scene: 2 },
        { ...file, scene: 1 },
      ]),
    ],
    /differ from runtime adoption test-a01/,
  );
  refused(
    [
      asset([
        { ...file, scene: 1 },
        { ...file, scene: 1 },
      ]),
    ],
    /differ from runtime adoption test-a01/,
  );
  refused([asset([{ ...file }, { ...file, scene: 2 }])], /differ from runtime adoption test-a01/);
  refused([asset([{ ...file, scene: 1 }])], /differ from runtime adoption test-a01/);
  refused(
    [
      asset([
        { ...file, scene: 1 },
        { ...file, scene: 2 },
        { ...file, scene: 3 },
      ]),
    ],
    /differ from runtime adoption test-a01/,
  );
  refused([asset(undefined, { scene: undefined })], /differ from runtime adoption test-a01/);
  // Same URL, another identity.
  refused(
    [
      asset([
        { ...file, scene: 1 },
        { ...file, bytes: 101, scene: 2 },
      ]),
    ],
    /differ from runtime adoption test-a01/,
  );
  refused(
    [
      { modelKey: 'pond', url: '/models/pond/model.glb', sha256: 'd'.repeat(64), bytes: 5 },
      { modelKey: 'lake', url: '/models/pond/model.glb', sha256: 'e'.repeat(64), bytes: 5 },
    ],
    /named with two identities/,
    null,
  );
  // Parts differ between levels of one file.
  refused(
    [
      asset([
        { ...file, scene: 1, parts: [{ url: '/x', bytes: 1 }] },
        { ...file, scene: 2 },
      ]),
    ],
    /different parts/,
  );
  // A scene outside an adopted packed entry, or a graph that packs inconsistently.
  refused(
    [
      {
        modelKey: 'pond',
        url: '/models/pond/model.glb',
        sha256: 'd'.repeat(64),
        bytes: 5,
        scene: 0,
      },
    ],
    /names a packed scene/,
    null,
  );
  refused(
    [asset()],
    /packs it inconsistently: its levels name different files/,
    adoption({
      ...entry,
      lods: [
        { ...file, scene: 1 },
        { ...file, sha256: 'f'.repeat(64), scene: 2 },
      ],
    }),
  );
  const plainName = {
    url: `/models/hill/model.opt-${digest.slice(0, 16)}.glb`,
    sha256: digest,
    bytes: 100,
  };
  refused(
    [
      {
        modelKey: 'hill',
        ...plainName,
        scene: 0,
        runtimeOptimization: { adoption: 'test-a01' },
        lods: [{ ...plainName, scene: 1 }],
      },
    ],
    /not a content-addressed model-levels file/,
    adoption({
      selection: 'ordinary-compressed',
      primary: { ...plainName, scene: 0 },
      lods: [{ ...plainName, scene: 1 }],
    }),
  );
});
