// Adopt a reviewed C2 revision and its compatible, source-derived LOD.
// Does not generate models, restart a server, publish, or overwrite C1 history.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const revision = process.argv[2] || '01';
assert.match(revision, /^\d{2}$/);
const base = 'output/model-generation/models/rimo-neko/candidate-2';
const folder = `${base}/work/rig/revision-${revision}`;
const source = `${folder}/candidate.glb`, lowSource = `${folder}/lod.glb`;
const read = async p => JSON.parse(await readFile(p, 'utf8'));
const save = (p, v) => writeFile(p, JSON.stringify(v, null, 2) + '\n');
const sha = b => createHash('sha256').update(b).digest('hex');
const documentOf = b => JSON.parse(b.subarray(20, 20+b.readUInt32LE(12)));
const trianglesOf = d => d.meshes.flatMap(m => m.primitives).reduce((n,p) => n+d.accessors[p.indices].count/3,0);
const [bytes, low, rig, motion, browser, preservation, lowMotion, happy] = await Promise.all([
  readFile(source), readFile(lowSource), read(`${folder}/process.json`),
  read(`${base}/qa/rig-${revision}/motion.json`), read(`${base}/qa/rig-${revision}/browser/result.json`),
  read(`${base}/qa/rig-${revision}/preservation.json`),read(`${base}/qa/rig-${revision}/lod-motion.json`),
  read(`${base}/qa/rig-${revision}/happy-contact.json`),
]);
assert.equal(rig.candidate, 2);
const digest=sha(bytes), doc=documentOf(bytes), lodDoc=documentOf(low);
assert.equal(rig.sha256, digest); assert.equal(motion.sha256,digest);
assert.equal(preservation.sha256,digest);assert.equal(preservation.missing,0);assert.ok(preservation.imageBytesRetained);
assert.equal(lowMotion.sha256,digest);assert.equal(lowMotion.lodSha256,sha(low));assert.equal(lowMotion.checks.length,7);
assert.equal(happy.sha256,digest);assert.equal(motion.checks.length,7);
assert.equal(browser.sourceSha256,digest); assert.deepEqual(browser.errors,[]);
if(rig.straightening){
  const alignment=await read(`${base}/qa/rig-${revision}/straightening.json`);
  assert.equal(alignment.status,'passed');assert.equal(alignment.sha256,digest);
  assert.ok(alignment.triangleConnectivityUvJointsWeightsByteIdentical);
}
assert.equal(doc.animations.length,7); assert.equal(lodDoc.animations?.length??0,0);
assert.ok(doc.nodes.some(n=>n.name==='PetContact'));
assert.deepEqual(lodDoc.skins[0].joints.map(i=>lodDoc.nodes[i].name),doc.skins[0].joints.map(i=>doc.nodes[i].name));
for (const file of [source,lowSource]) {
  const result=JSON.parse(execFileSync(process.execPath,['scripts/inspect-glb.mjs',file],{encoding:'utf8',windowsHide:true}));
  assert.equal(result.validation,'passed');
}
const old=await read('public/models/rimo-neko/asset.json');
await mkdir('assets/rimo-neko/history',{recursive:true});
async function retain(from,to) {
  const data=await readFile(from); let existing;
  try {existing=await readFile(to);} catch(e) {if(e.code!=='ENOENT')throw e;}
  if(existing) assert.equal(sha(existing),sha(data),`Refusing to overwrite ${to}`);
  else await writeFile(to,data);
}
if(old.candidate===1) for(const name of ['rig','adoption'])
  await retain(`assets/rimo-neko/${name}.json`,`assets/rimo-neko/history/${name}-c01-r10.json`);
if(old.candidate===1) await retain('public/models/rimo-neko/asset.json','assets/rimo-neko/history/asset-c01-r10.json');
if(old.candidate===2&&old.url!==`/models/rimo-neko/model-c02-r${revision}.glb`){
  const oldRevision=old.url.match(/model-c02-r(\d{2})\.glb$/)?.[1];assert.ok(oldRevision);
  for(const name of ['rig','adoption'])await retain(`assets/rimo-neko/${name}.json`,`assets/rimo-neko/history/${name}-c02-r${oldRevision}.json`);
  await retain('public/models/rimo-neko/asset.json',`assets/rimo-neko/history/asset-c02-r${oldRevision}.json`);
}
const modelUrl=`/models/rimo-neko/model-c02-r${revision}.glb`;
const lodUrl=`/models/rimo-neko/lod-c02-r${revision}.glb`;
await retain(source,'public'+modelUrl); await retain(lowSource,'public'+lodUrl);
const record={...old,candidate:2,url:modelUrl,sha256:digest,bytes:bytes.length,triangles:trianglesOf(doc),
  heightMetres:rig.heightMetres,widthMetres:rig.widthMetres,lengthMetres:rig.lengthMetres,
  clips:rig.clips,locomotion:rig.locomotion,
  lods:[{url:lodUrl,sha256:sha(low),bytes:low.length,triangles:trianglesOf(lodDoc),distanceMetres:6,
    purpose:'source-derived animated geometry; original skeleton/materials/clips retained'}],
  provenance:{provider:'Codex built-in imagegen; local TRELLIS-2; measured surface reduction and body-specific quadruped rig',claudeUsed:false,
    source,sourceSha256:digest,surface:'Candidate 2 / surface01',
    sourceSurfaceSha256:'284095b15d1e08fdfa7a7157ba5806c322e52d280d03a0f0436c8f2311761850',referenceImage:'assets/rimo-neko/source/reference-v2.png',
    referenceSha256:sha(await readFile('assets/rimo-neko/source/reference-v2.png')),visualReview:'assets/rimo-neko/adoption.json'},
  notes:['The user selected Candidate 2 surface01. Its gray-white fur, green eyes and plume tail are retained; rigging adds a small lip seam and mouth lining for Hiss.',
    'Original image, Candidate 1, interrupted generation, all C2 revisions and measured QA are retained.'],
};
if(rig.straightening){
  record.provenance.surface='Candidate 2 / surface01, head and tail aligned at user request';
  record.provenance.straightening=rig.straightening;
  record.notes.push('2026-10-03: face aligned forward and tail centred in the rest shape; original topology, UVs, weights and image bytes retained. Rest vertex positions intentionally corrected.');
}
await save('public/models/rimo-neko/asset.json',record);
for(const file of ['public/models/world-assets.json','assets/world-models.json']) {
  const data=await read(file), key=file.startsWith('public')?'modelKey':'key';
  const index=data.assets.findIndex(a=>a[key]==='rimo-neko'); assert.ok(index>=0);
  data.assets[index]=key==='modelKey'?record:{...data.assets[index],candidate:2,sha256:digest,delivery:modelUrl,triangles:record.triangles};
  await save(file,data);
}
await save('assets/rimo-neko/rig.json',rig);
await save('assets/rimo-neko/adoption.json',{decision:'adopt',candidate:2,revision,sha256:digest,source,triangles:record.triangles,bytes:bytes.length,
  viewerQA:`${base}/qa/rig-${revision}/browser/result.json`,motionQA:`${base}/qa/rig-${revision}/motion.json`,
  lodMotionQA:`${base}/qa/rig-${revision}/lod-motion.json`,happyContactQA:`${base}/qa/rig-${revision}/happy-contact.json`,
  preservationQA:`${base}/qa/rig-${revision}/preservation.json`,gameValidation:'pending'});

// Refresh only this cat's public derivatives; other assets remain untouched.
const manifest=await read('assets/public-performance/manifest.json');
const python=process.env.PERFORMANCE_PYTHON??'C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe';
for(const asset of [record,...record.lods]) {
  const file=`assets/public-performance/models/rimo-neko-${path.basename(asset.url,'.glb')}-tex2048.glb`;
  const details=JSON.parse(execFileSync(python,['scripts/optimize-public-glb.py','public'+asset.url,file,'2048'],{encoding:'utf8',windowsHide:true}));
  const optimized=await readFile(file), hash=sha(optimized), prefix=asset.url.includes('/lod-')?'lod':'model';
  manifest.records=manifest.records.filter(r=>r.sourceUrl!==asset.url);
  manifest.records.push({sourceUrl:asset.url,sourceSha256:asset.sha256,sourceBytes:asset.bytes,file,
    url:`/models/rimo-neko/${prefix}-web-${hash.slice(0,16)}.glb`,sha256:hash,bytes:optimized.length,maximumTextureEdge:2048,...details});
}
await save('assets/public-performance/manifest.json',manifest);
console.log(JSON.stringify({candidate:2,revision,sha256:digest,triangles:record.triangles,lodTriangles:record.lods[0].triangles}));
