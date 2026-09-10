// Adopt a new valley-pine low-poly revision (2026-09-10 smooth-foliage rework).
// Mirrors adopt-region-model.mjs: exact candidate bytes are copied, the SHA is
// recorded in asset.json, world-models.json and public/models/world-assets.json,
// and the previous delivery stays available in git history and in work/low-poly.
import {readFile,writeFile,copyFile,realpath,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {resolve,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {geometryScene} from './measure-collision-bounds.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),key='valley-pine',revision=process.argv[2];
assert.match(revision??'',/^\d{2}$/,'usage: node scripts/adopt-pine-revision.mjs <revision>');
const model=resolve(root,'output/model-generation/models',key),folder=await realpath(resolve(model,'work/low-poly',`candidate-${revision}`)),candidate=resolve(folder,'candidate.glb');
const inside=relative(await realpath(model),folder);assert.ok(inside&&!inside.startsWith('..')&&!isAbsolute(inside));
const json=async name=>JSON.parse(await readFile(name,'utf8')),save=(name,value)=>writeFile(name,JSON.stringify(value,null,2)+'\n'),sha=bytes=>createHash('sha256').update(bytes).digest('hex'),portable=file=>relative(root,file).replaceAll('\\','/');
const review=await json(resolve(model,`qa/adoption-review-rev${revision}.json`)),processReport=await json(resolve(folder,'process-report.json'));
const bytes=await readFile(candidate),hash=sha(bytes);assert.equal(review.decision,'adopt');assert.equal(review.sha256,hash);assert.equal(review.visualGate,'passed');
const inspection=JSON.parse(execFileSync(process.execPath,[resolve(root,'scripts/inspect-glb.mjs'),candidate],{encoding:'utf8'}));assert.equal(inspection.validation,'passed');assert.equal(inspection.animations.length,0);
const gltf=await geometryScene(candidate);gltf.scene.updateMatrixWorld(true);const bounds=new THREE.Box3().setFromObject(gltf.scene,true),size=bounds.getSize(new THREE.Vector3());
assert.ok(Math.abs(size.y-10)<0.05,`height ${size.y} must stay 10 m so existing placements scale correctly`);
const destination=resolve(root,'public/models',key);await mkdir(resolve(model,'geometry'),{recursive:true});
await copyFile(candidate,resolve(destination,'model.glb'));await copyFile(candidate,resolve(model,`geometry/accepted-rev${revision}.glb`));
assert.equal(sha(await readFile(resolve(destination,'model.glb'))),hash);
const reference=resolve(model,'source/original',review.referenceImage??'reference-v2.png');
const previous=await json(resolve(destination,'asset.json'));
const manifest={...previous,status:'reviewed-prototype',sha256:hash,bytes:bytes.length,triangles:inspection.triangles,heightMetres:size.y,widthMetres:Math.max(size.x,size.z),
  placement:{pivot:'ground-centred',min:bounds.min.toArray(),max:bounds.max.toArray()},clips:[],notes:review.notes,lods:[],
  provenance:{provider:review.provider,claudeUsed:review.claudeUsed,referenceGenerator:review.referenceGenerator,referenceImage:portable(reference),referenceSha256:sha(await readFile(reference)),reconstruction:review.reconstruction,candidateFile:portable(candidate),visualReview:portable(resolve(model,`qa/adoption-review-rev${revision}.json`))}};
for(const name of review.acceptedLods??['lod1']){
  const source=resolve(folder,`${name}.glb`),data=await readFile(source),check=JSON.parse(execFileSync(process.execPath,[resolve(root,'scripts/inspect-glb.mjs'),source],{encoding:'utf8'}));assert.equal(check.validation,'passed');
  await copyFile(source,resolve(destination,`${name}.glb`));manifest.lods.push({url:`/models/${key}/${name}.glb`,sha256:sha(data),bytes:data.length,triangles:check.triangles});
}
const catalogPath=resolve(root,'assets/world-models.json'),catalog=await json(catalogPath),entry=catalog.assets.find(a=>a.key===key);assert.ok(entry);
Object.assign(entry,{sha256:hash,referenceVersion:2,subject:review.subject??entry.subject});
await save(resolve(destination,'asset.json'),manifest);await save(catalogPath,catalog);
const worldPath=resolve(root,'public/models/world-assets.json'),world=await json(worldPath);world.assets=world.assets.map(a=>a.modelKey===key?manifest:a);await save(worldPath,world);
await save(resolve(model,'qa/delivery-inspection.json'),inspection);await save(resolve(model,'qa/delivery-manifest.json'),manifest);
const modelJsonPath=resolve(model,'model.json'),modelJson=await json(modelJsonPath);modelJson.artifacts.candidate=`work/low-poly/candidate-${revision}/candidate.glb`;modelJson.sha256=hash;modelJson.provenance.reworked='2026-09-10 smooth-foliage revision '+revision;await save(modelJsonPath,modelJson);
console.log(JSON.stringify({key,revision,sha256:hash,bytes:bytes.length,triangles:inspection.triangles,height:size.y,lods:manifest.lods},null,2));
