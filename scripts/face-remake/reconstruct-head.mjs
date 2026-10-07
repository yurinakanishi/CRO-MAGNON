// Local TRELLIS-2 head reconstruction for the 2026-10-07 face remake.
// node scripts/face-remake/reconstruct-head.mjs <key> <reference.png name in assets/face-remake/<key>/source> [seed]
// Output (ignored): output/face-remake/<key>/trellis/<ref>-res1024-seed<seed>.glb (+ ply, cutout, log)
// Record (tracked): assets/face-remake/<key>/reconstruction-<ref>-seed<seed>.json
import { spawn } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, basename } from 'node:path';

const [key, refName, seedText = '42'] = process.argv.slice(2);
if (!key || !refName) throw Error('usage: reconstruct-head.mjs <key> <reference.png> [seed]');
const seed = String(Number(seedText)).padStart(4, '0');
const studio = resolve('../threed-model-creation/trellis-studio');
const source = resolve('assets/face-remake', key, 'source', refName);
const stem = basename(refName, '.png');
const out = resolve('output/face-remake', key, 'trellis');
await mkdir(out, { recursive: true });
const target = resolve(out, `${stem}-res1024-seed${seed}.glb`);
try {
  await access(target);
  throw Error('Completed reconstruction exists: ' + target);
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
}
const sha = (b) => createHash('sha256').update(b).digest('hex');
const args = ['--image', source, '--output', target, '--models', resolve(studio, 'models'), '--seed', String(Number(seedText)),
  '--res', '1024', '--tex-res', '512', '--atlas', '2048', '--gpu', '0', '--require-gpu', '--bg-removal', 'birefnet',
  '--dump-bg', '--xatlas', '--webp', 'off'];
const log = createWriteStream(resolve(out, `${stem}-seed${seed}.log`));
const started = Date.now();
console.log(JSON.stringify({ key, status: 'reconstructing', target }));
const child = spawn(resolve(studio, 'runtime/trellis-cli.exe'), args, { windowsHide: true });
child.stdout.pipe(log);
child.stderr.pipe(log);
const code = await new Promise((ok, fail) => {
  child.on('error', fail);
  child.on('close', ok);
});
await new Promise((ok) => log.end(ok));
if (code !== 0) throw Error(`${key} TRELLIS failed: ${code}`);
const bytes = await readFile(target);
if (bytes.toString('ascii', 0, 4) !== 'glTF') throw Error('Invalid output');
const report = {
  key, status: 'dense-generated-unreviewed', generator: 'Local TRELLIS-2 C++ GGUF (trellis-studio runtime)',
  seed: Number(seedText), resolution: 1024, textureResolution: 512, atlas: 2048, seconds: (Date.now() - started) / 1000,
  reference: `assets/face-remake/${key}/source/${refName}`, referenceSha256: sha(await readFile(source)),
  output: `output/face-remake/${key}/trellis/${basename(target)}`, sha256: sha(bytes), bytes: bytes.length, args,
};
await writeFile(resolve('assets/face-remake', key, `reconstruction-${stem}-seed${seed}.json`), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
