// Add the contributor friend mascots and Howkey's flask to the public texture-optimization manifest.
// node scripts/prepare-friend-public-assets.mjs [key ...]
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
const python =
  process.env.PERFORMANCE_PYTHON ??
  'C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe';
const hash = (b) => createHash('sha256').update(b).digest('hex');
const { FRIEND_MASCOTS } = await import('../dist/shared/friend-mascots.mjs');
const keys = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [...FRIEND_MASCOTS.map((f) => f.key), 'howkey-flask'];
const file = 'assets/public-performance/manifest.json';
const manifest = JSON.parse(await readFile(file));
for (const key of keys) {
  const asset = JSON.parse(await readFile(`public/models/${key}/asset.json`));
  for (const record of [asset, ...asset.lods]) {
    const destination = `assets/public-performance/models/${asset.modelKey}-${path.basename(record.url, '.glb')}-tex2048.glb`;
    const details = JSON.parse(
      execFileSync(
        python,
        ['scripts/optimize-public-glb.py', 'public' + record.url, destination, '2048'],
        { encoding: 'utf8', windowsHide: true },
      ),
    );
    const bytes = await readFile(destination),
      sha256 = hash(bytes);
    const prefix = path.basename(record.url).startsWith('lod') ? 'lod' : 'model';
    const next = {
      sourceUrl: record.url,
      sourceSha256: record.sha256,
      sourceBytes: record.bytes,
      file: destination,
      url: `/models/${asset.modelKey}/${prefix}-web-${sha256.slice(0, 16)}.glb`,
      sha256,
      bytes: bytes.length,
      maximumTextureEdge: 2048,
      ...details,
    };
    const i = manifest.records.findIndex((r) => r.sourceUrl === record.url);
    if (i < 0) manifest.records.push(next);
    else manifest.records[i] = next;
    console.log(JSON.stringify(next));
  }
}
await writeFile(file, JSON.stringify(manifest, null, 2) + '\n');
