import { mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export async function prepareVendor({ cameraControls = true } = {}) {
  const root = new URL('../', import.meta.url);
  const destination = new URL('public/vendor/', root);
  await mkdir(destination, { recursive: true });
  await Promise.all(
    ['three.module.js', 'three.core.js'].map((name) =>
      copyFile(new URL(`node_modules/three/build/${name}`, root), new URL(name, destination)),
    ),
  );
  const addons = [
    'loaders/GLTFLoader.js',
    'utils/BufferGeometryUtils.js',
    'utils/SkeletonUtils.js',
    'controls/OrbitControls.js',
  ];
  await Promise.all(
    addons.map(async (name) => {
      const target = new URL(`addons/${name}`, destination);
      await mkdir(new URL('./', target), { recursive: true });
      await copyFile(new URL(`node_modules/three/examples/jsm/${name}`, root), target);
    }),
  );
  console.log('Three.js core and GLB review modules ready.');
  if (cameraControls) await import('./prepare-motion-assets.mjs');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await prepareVendor({ cameraControls: !process.argv.includes('--without-hands') });
