// Prepare the local server's delivery overlay (dist/delivery/overlay.json): every model and
// runtime texture the current manifests name, cooked as the packaged builds ship them
// (scripts/delivery). The local server reads it at start (infrastructure/node/delivery-overlay.mts)
// and rewrites only records whose master is still the one cooked here. Masters are never written.
//   node scripts/delivery/prepare-overlay.mjs        (also run by npm start / npm run dev)
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runtimeTextureRecords } from '../environment-assets.mjs';
import { pruneCache } from './delivery-cache.mjs';
import { deliveryGraph } from './delivery-graph.mjs';
import { characterModelReleased } from '../../dist/shared/character-roster.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const started = Date.now();
const catalog = JSON.parse(
  await readFile(path.join(root, 'public/models/world-assets.json'), 'utf8'),
);
const assets = catalog.assets.filter((asset) => characterModelReleased(asset.modelKey));
for (const entry of await readdir(path.join(root, 'public/models'), { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  let own;
  try {
    own = JSON.parse(
      await readFile(path.join(root, 'public/models', entry.name, 'asset.json'), 'utf8'),
    );
  } catch (error) {
    if (error.code === 'ENOENT') continue;
    throw error;
  }
  if (typeof own.url !== 'string' || !characterModelReleased(own.modelKey)) continue;
  const listed = assets.find((asset) => asset.modelKey === own.modelKey);
  // A model's own manifest naming other files than the catalog is served as it is.
  if (!listed) assets.push(own);
}
const graph = await deliveryGraph(root, assets, { textureRecords: runtimeTextureRecords });
const cache = path.join(root, 'dist/delivery/cache');
const table = (deliveries) =>
  Object.fromEntries(
    [...deliveries]
      .filter(([, d]) => d.cooked)
      .map(([url, d]) => {
        const file = path.relative(cache, d.file);
        if (file.includes(path.sep) || file.startsWith('..'))
          throw new Error(`${url}: cache file outside the cache`);
        return [
          url,
          {
            master: { sha256: d.report.master.sha256, bytes: d.report.master.bytes },
            delivery: {
              url: d.url,
              sha256: d.sha256,
              bytes: d.bytes,
              ...(d.scene !== undefined ? { scene: d.scene } : {}),
            },
            file,
          },
        ];
      })
      .sort(([a], [b]) => a.localeCompare(b)),
  );
const overlay = {
  schema: 'cro-magnon/delivery-overlay@1',
  recipe: graph.recipe.digest,
  summary: graph.summary,
  models: table(graph.deliveries),
  textures: table(graph.textures),
};
await mkdir(path.join(root, 'dist/delivery'), { recursive: true });
const target = path.join(root, 'dist/delivery/overlay.json');
await writeFile(`${target}.${process.pid}.tmp`, JSON.stringify(overlay, null, 2));
await rename(`${target}.${process.pid}.tmp`, target);
const pruned = await pruneCache(root);
const mib = (n) => (n / 1048576).toFixed(1);
console.log(
  `Delivery overlay: ${Object.keys(overlay.models).length} model records (${graph.summary.deliveryFiles} files, ${mib(graph.summary.masterBytes)} → ${mib(graph.summary.deliveryBytes)} MiB), ${Object.keys(overlay.textures).length} textures; ${pruned} stale cache files removed; ${((Date.now() - started) / 1000).toFixed(1)} s.`,
);
