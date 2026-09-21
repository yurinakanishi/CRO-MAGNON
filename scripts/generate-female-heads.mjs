import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
const studio = resolve('../threed-model-creation/trellis-studio');
const sha = (b) => createHash('sha256').update(b).digest('hex');
for (const key of ['cro-magnon-woman', 'neanderthal-woman']) {
  const base = resolve('assets/female-face-repair', key);
  const out = resolve(base, 'work/trellis');
  await mkdir(out, { recursive: true });
  const source = resolve(base, 'source/reference-v1.png'),
    target = resolve(out, 'head-res1024-seed0042.glb');
  try {
    await access(target);
    throw Error('Completed candidate exists: ' + target);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  const args = [
    '--image',
    source,
    '--output',
    target,
    '--models',
    resolve(studio, 'models'),
    '--seed',
    '42',
    '--res',
    '1024',
    '--tex-res',
    '512',
    '--atlas',
    '2048',
    '--gpu',
    '0',
    '--require-gpu',
    '--bg-removal',
    'birefnet',
    '--dump-bg',
    '--xatlas',
    '--webp',
    'off',
  ];
  const log = createWriteStream(resolve(out, 'generation.log'));
  const started = Date.now();
  console.log(JSON.stringify({ key, status: 'reconstructing', target }));
  const child = spawn(resolve(studio, 'runtime/trellis-cli.exe'), args, { windowsHide: true });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  const code = await new Promise((r, j) => {
    child.on('error', j);
    child.on('close', r);
  });
  await new Promise((r) => log.end(r));
  if (code !== 0) throw Error(key + ' TRELLIS failed: ' + code);
  const bytes = await readFile(target);
  if (bytes.toString('ascii', 0, 4) !== 'glTF') throw Error('Invalid output');
  const report = {
    key,
    status: 'dense-generated-unreviewed',
    generator: 'Local TRELLIS-2 C++ GGUF',
    seed: 42,
    resolution: 1024,
    textureResolution: 512,
    atlas: 2048,
    seconds: (Date.now() - started) / 1000,
    referenceSha256: sha(await readFile(source)),
    sha256: sha(bytes),
    bytes: bytes.length,
    args,
  };
  await writeFile(resolve(out, 'reconstruction.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
}
