import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = new URL('../', import.meta.url);
const pkg = JSON.parse(
  await readFile(new URL('node_modules/@mediapipe/tasks-vision/package.json', root)),
);
if (pkg.version !== '1.0.1')
  throw new Error('Motion controls require @mediapipe/tasks-vision 1.0.1. Run npm ci.');
const files = [
  'vision_bundle.mjs',
  'wasm/vision_wasm_module_internal.js',
  'wasm/vision_wasm_module_internal.wasm',
];
const records = [];
for (const file of files) {
  const source = new URL(`node_modules/@mediapipe/tasks-vision/${file}`, root);
  const target = new URL(`public/vendor/mediapipe/${file}`, root);
  await mkdir(new URL('./', target), { recursive: true });
  await copyFile(source, target);
  const data = await readFile(target);
  records.push({
    url: `/vendor/mediapipe/${file}`,
    bytes: data.length,
    sha256: createHash('sha256').update(data).digest('hex'),
  });
}
const model = await readFile(new URL('public/motion/hand_landmarker-float16-v1.task', root));
const sha256 = createHash('sha256').update(model).digest('hex');
if (sha256 !== 'fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1')
  throw new Error('Hand Landmarker model integrity mismatch');
records.push({ url: '/motion/hand_landmarker-float16-v1.task', bytes: model.length, sha256 });
await writeFile(
  new URL('public/motion/assets.json', root),
  JSON.stringify(
    {
      package: '@mediapipe/tasks-vision',
      version: pkg.version,
      modelSource:
        'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
      license: 'Apache-2.0',
      files: records,
    },
    null,
    2,
  ) + '\n',
);
console.log('Local Hand Landmarker model and MediaPipe module WASM verified and prepared.');
