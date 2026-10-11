// Low-poly head revision of the face-remade characters: geometry (lowpoly-head.mjs) → Blender
// bake (bake-head.py) → GLB (assemble-head.mjs) → face review sheets (qa-lowpoly-head.mjs).
//
//   node scripts/face-remake/lowpoly-heads.mjs --revision r03 [--keys cro-magnon-woman,...]
//
// Masters are the currently served character files (their manifest records); the bake source is
// each character's 2048 face-remake GLB. Both are pinned by SHA-256. Outputs and step logs go to
// output/head-lowpoly/<key>/<revision>/; nothing under public/ or assets/ is written
// (adopt-lowpoly-head.mjs adopts a reviewed revision).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';

const root = path.resolve(import.meta.dirname, '../..');

// Face landmarks from the 2026-10-07 face remake grafts (output/face-remake/final-grafts.sh):
// the eye row, and the chin (the Neanderthal man's graft recorded the mouth, 1.485; his chin
// and beard are taken from 1.43).
// Each master is the startup file runtime adoption 20261010-r07-a01 serves.
export const HEADS = Object.freeze({
  'cro-magnon-woman': {
    eye: 1.5325,
    chin: 1.435,
    master: '/models/cro-magnon-woman/startup.opt-f414686fe312f6e3.glb',
    sha256: 'f414686fe312f6e3d67855644dc0d3b79a1c942484e2a60b0c977e4af370fb2b',
    texture: '/models/cro-magnon-woman/model-face-r01.glb',
    textureSha256: 'c8082f13995cebd42d674f6d4b5c87a61d441597d5670aec8803ca5006fdf2c1',
  },
  'neanderthal-woman': {
    eye: 1.451,
    chin: 1.351,
    master: '/models/neanderthal-woman/startup.opt-fabb21a67061a199.glb',
    sha256: 'fabb21a67061a199d24efac0e6196a0477cba02d73eab259bb6810a70e6ecd8d',
    texture: '/models/neanderthal-woman/model-face-r01.glb',
    textureSha256: 'b4c416900e972c8850892b7a5f886e62478894d1c958cf35830dc7ea1672dde9',
  },
  'neanderthal-hunter': {
    eye: 1.5625,
    chin: 1.43,
    master: '/models/neanderthal-hunter/startup.opt-ef3e3fa2f2931daf.glb',
    sha256: 'ef3e3fa2f2931dafe233560f29715b484440b46460f225dfd44c31c6e44faaeb',
    texture: '/models/neanderthal-hunter/model-face-r01.glb',
    textureSha256: '6910fd3396bcde7934e9af23fa2130ca5c1bca9a08da0d00fe5582076b94352b',
  },
});
// One policy for all three (docs/head-lowpoly-2026-10-11.md).
export const POLICY = Object.freeze({
  target: 12000,
  crack: 0.001,
  'face-crack': 0.0025,
  error: 0.02,
  'skin-error': 0.002,
  'face-error': 0.0008,
  band: 0.025,
  pad: 12,
});
// The bake: 2048 square, delivered at 1024; the face islands at twice the texel density of the
// rest; 4 bake texels (2 delivered) between packed islands; Smart UV charts within 66 degrees.
export const BAKE = Object.freeze({ size: 2048, 'face-scale': 2, margin: 4, angle: 66 });

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const glbTriangles = (bytes) => {
  const json = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
  return json.meshes
    .flatMap((mesh) => mesh.primitives)
    .reduce((sum, primitive) => sum + json.accessors[primitive.indices].count / 3, 0);
};

if (process.argv[1]?.endsWith('lowpoly-heads.mjs')) {
  const { values: args } = parseArgs({
    options: {
      revision: { type: 'string' },
      keys: { type: 'string', default: '' },
      blender: {
        type: 'string',
        default:
          process.env.BLENDER ?? 'C:/Program Files/Blender Foundation/Blender 3.6/blender.exe',
      },
    },
  });
  if (!/^r\d{2}$/.test(args.revision ?? '')) throw new Error('--revision rNN is required');
  const run = async (command, argv, log) => {
    const result = spawnSync(command, argv, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 });
    await writeFile(path.join(root, log), `${result.stdout ?? ''}${result.stderr ?? ''}`);
    if (result.status !== 0)
      throw new Error(
        `${log}: exit ${result.status}\n${(result.stderr || result.stdout).slice(-3000)}`,
      );
  };
  const pinned = async (url, hash) => {
    const bytes = await readFile(path.join(root, 'public', url));
    if (sha256(bytes) !== hash) throw new Error(`public${url} is not the pinned file`);
    return bytes;
  };
  const keys = args.keys ? args.keys.split(',') : Object.keys(HEADS);
  const summary = {
    schema: 'cro-magnon/lowpoly-head-summary@1',
    revision: args.revision,
    policy: POLICY,
    bake: BAKE,
    heads: {},
  };
  for (const key of keys) {
    const head = HEADS[key];
    if (!head) throw new Error(`No low-poly head settings for ${key}`);
    const masterBytes = await pinned(head.master, head.sha256);
    const textureBytes = await pinned(head.texture, head.textureSha256);
    const master = `public${head.master}`;
    const work = `output/head-lowpoly/${key}/${args.revision}`;
    const glb = `${work}/${key}-${args.revision}.glb`;
    const policy = Object.entries(POLICY).flatMap(([name, value]) => [`--${name}`, String(value)]);
    const bake = Object.entries(BAKE).flatMap(([name, value]) => [`--${name}`, String(value)]);
    await mkdir(path.join(root, work), { recursive: true });
    await run(
      process.execPath,
      [
        'scripts/face-remake/lowpoly-head.mjs',
        '--master',
        master,
        '--texture',
        `public${head.texture}`,
        '--out',
        work,
        '--eye',
        String(head.eye),
        '--chin',
        String(head.chin),
        ...policy,
      ],
      `${work}/geometry.log`,
    );
    // One Blender thread: the bake is then bit-identical from run to run (bake-head.py).
    await run(
      args.blender,
      [
        '-b',
        '-t',
        '1',
        '--factory-startup',
        '-P',
        'scripts/face-remake/bake-head.py',
        '--',
        path.join(root, work),
        ...bake,
      ],
      `${work}/blender.log`,
    );
    await run(
      process.execPath,
      ['scripts/face-remake/assemble-head.mjs', '--master', master, '--work', work, '--out', glb],
      `${work}/assemble.log`,
    );
    await run(
      process.execPath,
      [
        'scripts/face-remake/qa-lowpoly-head.mjs',
        '--adopted',
        master,
        '--candidate',
        glb,
        '--out',
        `${work}/qa`,
      ],
      `${work}/qa.log`,
    );
    const geometry = JSON.parse(await readFile(path.join(root, work, 'geometry.json'), 'utf8'));
    const assembled = JSON.parse(await readFile(path.join(root, `${glb}.json`), 'utf8'));
    const review = JSON.parse(await readFile(path.join(root, work, 'qa/report.json'), 'utf8'));
    const candidate = review.seam.filter((s) => s.name === 'candidate'),
      adopted = review.seam.filter((s) => s.name === 'adopted');
    const sheets = [];
    for (const name of ['face-bind', 'face-albedo', 'head-poses', 'body']) {
      const file = `${work}/qa/sheet-${name}.jpg`;
      sheets.push({ path: file, sha256: sha256(await readFile(path.join(root, file))) });
    }
    summary.heads[key] = {
      master: {
        url: head.master,
        sha256: head.sha256,
        bytes: masterBytes.length,
        triangles: glbTriangles(masterBytes),
      },
      textureSource: { url: head.texture, sha256: head.textureSha256, bytes: textureBytes.length },
      candidate: {
        file: glb,
        sha256: assembled.sha256,
        bytes: assembled.bytes,
        triangles: glbTriangles(await readFile(path.join(root, glb))),
        head: assembled.head,
        headBefore: assembled.master,
      },
      landmarks: { eye: head.eye, chin: head.chin },
      options: geometry.options,
      passes: geometry.passes,
      orientation: geometry.orientation,
      neckSeam: geometry.neckSeam,
      // Shared neck-ring vertices checked in each sampled clip (0 when the head shares none).
      seam: {
        sewnVertices: Math.max(...candidate.map((s) => s.sewn)),
        worstMetres: Math.max(...candidate.map((s) => s.worst)),
        // Largest angle between the head's and the body's normal at a shared vertex (and the
        // adopted model's, for comparison).
        normalDegrees: Math.max(...candidate.map((s) => s.normalDegrees)),
        adoptedNormalDegrees: Math.max(...adopted.map((s) => s.normalDegrees)),
      },
      psnr: Object.fromEntries(review.views.map((v, i) => [`${i}:${v.label}`, v.psnr])),
      browserErrors: review.errors.length,
      sheets,
    };
    console.log(
      `${key}: head ${assembled.master.headTriangles} → ${assembled.head.triangles} triangles, ${assembled.bytes} B, ${assembled.sha256}`,
    );
  }
  await writeFile(
    path.join(root, `output/head-lowpoly/summary-${args.revision}.json`),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
}
