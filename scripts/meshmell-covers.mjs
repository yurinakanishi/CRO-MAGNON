import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const reference = resolve(root, '../threed-model-creation');
const renderer = resolve(reference, 'trellis.cpp/tools/mv_preview/render_composite_frames.mjs');
const cli = resolve(root, '../meshmell.com/packages/cli/dist/src/bin.js');
const out = resolve(root, 'assets/meshmell');
const read = p => JSON.parse(readFileSync(resolve(root, p), 'utf8'));
const hash = p => createHash('sha256').update(readFileSync(p)).digest('hex');
const save = (p, value) => writeFileSync(resolve(out, p), JSON.stringify(value, null, 2) + '\n');
const portable = p => relative(root, p).replaceAll('\\', '/');
const uploads = read('assets/meshmell/uploads.json');
const backgroundKeys = {
  forest: 'roaring-bear-on-rock-base-in-dark-bronze',
  grassland: 'standing-ram-with-curled-fleece-and-spiral-horns',
  desert: 'standing-meerkat-on-rock-base',
  mountain: 'spread-wing-eagle-on-rock-base-in-dark-bronze',
  tabletop: 'pair-of-connected-red-cherries',
};
const previous = existsSync(resolve(out, 'covers.json')) ? read('assets/meshmell/covers.json').models : [];
const records = [];
mkdirSync(resolve(out, 'history'), { recursive: true });
for (const model of uploads.models) {
  assert.equal(hash(resolve(root, model.path)), model.sha256);
  const manifest = read(`public/models/${model.key}/asset.json`);
  const terrain = /ground$|river-water/.test(model.key);
  const backgroundKind = model.key === 'mammoth-meat' ? 'tabletop' : /desert/.test(model.key) ? 'desert'
    : /ice-ground|snow-ground|glacier|volcanic/.test(model.key) ? 'mountain'
    : /meadow|mammoth|neanderthal|cro-magnon/.test(model.key) ? 'grassland' : 'forest';
  const background = resolve(reference, `models/${backgroundKeys[backgroundKind]}/media/background.png`);
  const revision = model.key === 'mammoth-meat' ? 'r02' : ['flint-spear', 'valley-pine'].includes(model.key) ? 'r03' : 'r01';
  const selectedRenderer = revision === 'r03' ? resolve(root, 'output/meshmell-covers/renderer/render_composite_frames.mjs') : renderer;
  if (revision === 'r03' && !existsSync(selectedRenderer)) {
    mkdirSync(dirname(selectedRenderer), { recursive: true });
    copyFileSync(renderer, selectedRenderer);
    copyFileSync(resolve(dirname(renderer), 'model-viewer.min.js'), resolve(dirname(selectedRenderer), 'model-viewer.min.js'));
    const html = readFileSync(resolve(dirname(renderer), 'index.html'), 'utf8').replace('<model-viewer id="mv"', '<model-viewer max-camera-orbit="auto auto 1000m" id="mv"');
    writeFileSync(resolve(dirname(selectedRenderer), 'index.html'), html);
  }
  const directory = resolve(root, `output/meshmell-covers/${model.key}/${revision}`);
  const image = resolve(directory, 'cover-0000.jpg');
  const idle = manifest.clips?.find(c => c.name === 'Idle_Loop');
  const camera = { canonicalFront: manifest.forwardAxis ?? '+Z', side: 'right-front', azimuthDegrees: 45, polarDegrees: terrain || model.key === 'mammoth-meat' ? 65 : 80, distance: revision === 'r03' ? '120%' : 'auto', ...(revision === 'r03' ? { maximumOrbit: 'auto auto 1000m' } : {}) };
  if (!existsSync(image)) {
    console.log(`Rendering ${model.key}...`);
    execFileSync(process.execPath, [selectedRenderer, '--src', resolve(root, model.path), '--background', background,
      '--output-dir', directory, '--prefix', 'cover-', '--total', '1', '--steps', '1', '--workers', '1',
      '--start', String(camera.azimuthDegrees), '--phi', String(camera.polarDegrees), '--distance', camera.distance, '--min-bytes', '10000', '--settle-ms', '800',
      ...(idle ? ['--animation-name', idle.name, '--animation-duration', String(idle.seconds)] : [])],
    { env: { ...process.env, CODEX_NODE_MODULES: resolve(root, '../meshmell.com/node_modules') }, stdio: ['ignore', 'pipe', 'pipe'], timeout: 180000 });
  }
  const prior = previous.find(r => r.key === model.key && r.revision === revision);
  const record = { key: model.key, modelId: model.modelId, url: model.url, source: model.path, sourceSha256: model.sha256,
    image: portable(image), imageSha256: hash(image), imageBytes: readFileSync(image).length, width: 960, height: 960,
    background: portable(background), backgroundSha256: hash(background), camera, animation: idle?.name ?? null,
    renderer: portable(selectedRenderer), referenceRenderer: portable(renderer), rendererSha256: hash(selectedRenderer), revision, renderedAt: prior?.renderedAt ?? new Date().toISOString(),
    visuallyApproved: prior?.visuallyApproved ?? false, uploaded: prior?.uploaded ?? false,
    ...(prior?.remoteImage ? { remoteImage: prior.remoteImage, uploadedAt: prior.uploadedAt } : {}) };
  if (prior) assert.equal(prior.imageSha256, record.imageSha256, 'Use a new revision when regenerating a cover.');
  records.push(record);
  save('covers.json', { models: records });
  if (!prior) {
    const stamp = record.renderedAt.replace(/[-:.]/g, '');
    writeFileSync(resolve(out, `history/${stamp}-${model.key}-cover-render.json`), JSON.stringify({ action: 'cover-render', ...record }, null, 2) + '\n', { flag: 'wx' });
  }
  console.log(`Rendered ${model.key}.`);
}

function call(args) {
  try { return JSON.parse(execFileSync(process.execPath, [cli, '--json', ...args], { encoding: 'utf8', env: { ...process.env, MESHMELL_CREDENTIAL_STORE: 'file' }, timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'] })); }
  catch (error) {
    let code = 'CLI_FAILED';
    try { code = JSON.parse(String(error.stdout)).error.code; } catch {}
    throw new Error(`${args.slice(0, 3).join(' ')}: ${code}`);
  }
}
if (process.argv.includes('--upload')) {
  assert.equal(records.length, 31);
  assert.ok(records.every(r => r.visuallyApproved), 'Review every cover before upload.');
  const auth = call(['auth', 'status']);
  assert.equal(auth.principal.email, 'yurinakanishi@meshmell.com');
  for (const record of records) {
    if (record.uploaded) { console.log(`Already uploaded: ${record.key}`); continue; }
    const before = call(['models', 'get', String(record.modelId)]).data;
    assert.equal(before.owner.id, auth.principal.id);
    console.log(`Setting cover ${record.key}...`);
    const update = call(['models', 'update', String(record.modelId), '--cover-image', resolve(root, record.image), '--idempotency-key', `cover-${record.modelId}-${record.imageSha256.slice(0, 20)}`]);
    const after = call(['models', 'get', String(record.modelId)]).data;
    assert.ok(after.image?.id > 0);
    assert.deepEqual(after.image, update.data.image);
    for (const field of ['id', 'name', 'slug', 'description', 'license', 'credit', 'isPublic', 'scale', 'defaultActionId', 'defaultCameraDistance']) assert.deepEqual(after[field], before[field], `${record.key}: ${field} changed`);
    record.uploaded = true;
    record.remoteImage = after.image;
    record.uploadedAt = new Date().toISOString();
    save('covers.json', { models: records });
    const model = uploads.models.find(m => m.modelId === record.modelId);
    model.cover = { image: record.image, sha256: record.imageSha256, remoteImage: after.image, verifiedAt: record.uploadedAt };
    model.readback = after;
    save('uploads.json', uploads);
    const stamp = record.uploadedAt.replace(/[-:.]/g, '');
    writeFileSync(resolve(out, `history/${stamp}-${record.key}-cover-upload.json`), JSON.stringify({ action: 'cover-update', account: auth.principal.email, ...record, requestId: update.meta?.requestId, readback: after }, null, 2) + '\n', { flag: 'wx' });
    console.log(`Verified cover ${record.key}: image ${after.image.id}.`);
  }
}
