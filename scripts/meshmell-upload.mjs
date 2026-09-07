import { readFileSync, readdirSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = resolve(root, '../meshmell.com/packages/cli/dist/src/bin.js');
const out = resolve(root, 'assets/meshmell');
const json = p => JSON.parse(readFileSync(resolve(root, p), 'utf8'));
const save = (p, value) => writeFileSync(resolve(out, p), JSON.stringify(value, null, 2) + '\n');
mkdirSync(resolve(out, 'history'), { recursive: true });
const catalog = json('assets/world-models.json');
const models = readdirSync(resolve(root, 'public/models'), { withFileTypes: true })
  .filter(d => d.isDirectory() && existsSync(resolve(root, 'public/models', d.name, 'model.glb')))
  .map(d => {
    const key = d.name, path = `public/models/${key}/model.glb`;
    const manifest = json(`public/models/${key}/asset.json`);
    const bytes = readFileSync(resolve(root, path));
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    assert.equal(sha256, manifest.sha256, `${key}: manifest hash`);
    assert.equal(bytes.length, manifest.bytes, `${key}: byte size`);
    const spec = catalog.assets.find(a => a.key === key);
    if (spec) assert.equal(sha256, spec.sha256, `${key}: catalog hash`);
    const doc = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8').trim());
    assert.equal(bytes.readUInt32LE(0), 0x46546c67);
    assert.equal(bytes.readUInt32LE(8), bytes.length);
    const clips = (doc.animations ?? []).map(a => a.name).sort();
    assert.deepEqual(clips, (manifest.clips ?? []).map(a => a.name).sort(), `${key}: clips`);
    const inspection = JSON.parse(execFileSync(process.execPath, [resolve(root, 'scripts/inspect-glb.mjs'), resolve(root, path)], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }));
    assert.equal(inspection.validation, 'passed', `${key}: GLB inspection`);
    const name = key.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
    const description = `${name}, created for the CRO-MAGNON multiplayer game using an AI-generated reference image and local TRELLIS-2 image-to-3D reconstruction, followed by mesh refinement.${clips.length ? ` Rigged and animated; includes ${clips.length} animation clips: ${clips.join(', ')}.` : ''} Original game GLB with embedded materials and textures.`;
    return { key, path, sha256, bytes: bytes.length, name, slug: key, description, license: 'CC-BY-4.0', credit: 'Yuri Nakanishi', visibility: 'public', clips, idempotencyKey: `${key}-${sha256.slice(0, 16)}` };
  });
assert.equal(models.length, 31);
save('plan.json', { createdAt: new Date().toISOString(), authorization: 'User approved all 31 adopted GLBs, public, CC-BY-4.0, Yuri Nakanishi on 2026-09-07.', models });
console.log(`Verified ${models.length} GLBs; ${(models.reduce((s, m) => s + m.bytes, 0) / 1048576).toFixed(1)} MiB.`);

function call(args) {
  try {
    return JSON.parse(execFileSync(process.execPath, [cli, '--json', ...args], { encoding: 'utf8', env: { ...process.env, MESHMELL_CREDENTIAL_STORE: 'file' }, timeout: 12 * 60 * 1000, maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }));
  } catch (error) {
    let code = 'CLI_FAILED';
    try { code = JSON.parse(String(error.stdout)).error.code; } catch {}
    // Never expose raw CLI output: it can contain resumable capabilities.
    throw new Error(`${args.slice(0, 3).join(' ')}: ${code}`);
  }
}
function sourceCall(args) {
  try { return JSON.parse(execFileSync(process.execPath, ['--import', pathToFileURL(resolve(root, '../meshmell.com/node_modules/tsx/dist/loader.mjs')).href, resolve(root, 'scripts/meshmell-cli-source.mjs'), '--json', ...args], { encoding: 'utf8', env: { ...process.env, MESHMELL_CREDENTIAL_STORE: 'file' }, timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'] })); }
  catch { throw new Error(`Official source CLI failed: ${args.slice(0, 3).join(' ')}`); }
}
if (process.argv.includes('--upload')) {
  const auth = call(['auth', 'status']);
  assert.equal(auth.authenticated, true);
  assert.equal(auth.principal.email, 'yurinakanishi@meshmell.com');
  for (const scope of ['models:read', 'models:write', 'uploads:write']) assert.ok(auth.principal.scopes.includes(scope));
  const records = existsSync(resolve(out, 'uploads.json')) ? json('assets/meshmell/uploads.json').models : [];
  for (const model of models) {
    if (records.some(r => r.key === model.key && r.sha256 === model.sha256 && r.verified)) { console.log(`Already verified: ${model.key}`); continue; }
    const found = call(['models', 'list', '--query', model.name, '--limit', '100']);
    assert.equal(found.meta.hasMore, false, `${model.key}: search requires pagination`);
    const existing = found.data.find(m => m.slug === model.slug);
    const prior = records.find(r => r.key === model.key && r.sha256 === model.sha256);
    const recover = existing && existing.owner.id === auth.principal.id && existing.id === prior?.modelId;
    assert.ok(!existing || recover, `${model.key}: existing slug; inspect before updating`);
    console.log(`${recover ? 'Verifying existing' : 'Uploading'} ${model.key}...`);
    const response = recover ? { data: existing } : call(['models', 'upload', resolve(root, model.path), '--name', model.name, '--slug', model.slug, '--license', model.license, '--credit', model.credit, '--description', model.description, '--public', '--requires-credit-for-commercial-use', 'true', '--requires-credit-for-personal-use', 'true', '--idempotency-key', model.idempotencyKey, '--wait-timeout', '10m']);
    const operation = response.data;
    if (operation.status) assert.equal(operation.status, 'SUCCEEDED');
    const modelId = operation.result?.resourceId ?? operation.id;
    assert.ok(Number.isInteger(modelId) && modelId > 0);
    const record = { ...model, modelId, url: `https://meshmell.com/ja/viewer/models/${model.slug}`, uploadedAt: existing?.createdAt ?? new Date().toISOString(), account: auth.principal.email, operationId: operation.status ? operation.id : undefined, operationStatus: operation.status, requestId: response.meta?.requestId, verified: false };
    if (prior) records.splice(records.indexOf(prior), 1, record); else records.push(record);
    save('uploads.json', { models: records });
    const readback = call(['models', 'get', String(modelId)]);
    const remote = readback.data;
    record.readback = remote;
    save('uploads.json', { models: records });
    assert.equal(remote.owner.id, auth.principal.id);
    for (const field of ['name', 'slug', 'description', 'license', 'credit']) assert.equal(remote[field], model[field], `${model.key}: ${field}`);
    assert.equal(remote.isPublic, true);
    assert.equal(remote.requiresCreditForCommercialUse, true);
    assert.equal(remote.requiresCreditForPersonalUse, true);
    const actions = sourceCall(['models', 'actions', 'list', String(modelId)]);
    record.actions = actions.data;
    record.actionRegistrationMatches = JSON.stringify(actions.data.map(a => a.name).sort()) === JSON.stringify(model.clips);
    const downloadDir = resolve(root, 'output/meshmell-readback');
    mkdirSync(downloadDir, { recursive: true });
    const downloadPath = resolve(downloadDir, `${model.key}.glb`);
    call(['models', 'download', String(modelId), '--output', downloadPath, '--overwrite']);
    record.downloadSha256 = createHash('sha256').update(readFileSync(downloadPath)).digest('hex');
    assert.equal(record.downloadSha256, model.sha256, `${model.key}: remote GLB bytes`);
    record.displayFileState = 'READY';
    record.verified = true;
    record.verifiedAt = new Date().toISOString();
    save('uploads.json', { models: records });
    const stamp = record.verifiedAt.replace(/[-:.]/g, '');
    writeFileSync(resolve(out, `history/${stamp}-${model.key}-upload.json`), JSON.stringify(record, null, 2) + '\n', { flag: 'wx' });
    console.log(`Verified ${model.key}: model ${modelId} (${record.actions.length} actions).`);
  }
}
