// Adopt a ground-cover low-poly revision (2026-09-10/11 grass rework):
//   node scripts/adopt-foliage-revision.mjs meadow-grass 02
//   node scripts/adopt-foliage-revision.mjs meadow-sprig 01
// Exact candidate bytes are copied, the SHA is recorded in asset.json,
// assets/world-models.json and public/models/world-assets.json. A key that is
// new to world-assets.json is appended; an existing one is replaced in place.
import {readFile,writeFile,copyFile,realpath,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {resolve,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {geometryScene} from './measure-collision-bounds.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),key=process.argv[2],revision=process.argv[3];
assert.ok(['meadow-grass','meadow-sprig'].includes(key),'key must be meadow-grass or meadow-sprig');assert.match(revision??'',/^\d{2}$/);
const model=resolve(root,'output/model-generation/models',key),folder=await realpath(resolve(model,'work/low-poly',`candidate-${revision}`)),candidate=resolve(folder,'candidate.glb');
const inside=relative(await realpath(model),folder);assert.ok(inside&&!inside.startsWith('..')&&!isAbsolute(inside));
const json=async name=>JSON.parse(await readFile(name,'utf8')),save=(name,value)=>writeFile(name,JSON.stringify(value,null,2)+'\n'),sha=bytes=>createHash('sha256').update(bytes).digest('hex'),portable=file=>relative(root,file).replaceAll('\\','/');
const review=await json(resolve(model,`qa/adoption-review-rev${revision}.json`));
const bytes=await readFile(candidate),hash=sha(bytes);assert.equal(review.decision,'adopt');assert.equal(review.sha256,hash);assert.equal(review.visualGate,'passed');
const inspection=JSON.parse(execFileSync(process.execPath,[resolve(root,'scripts/inspect-glb.mjs'),candidate],{encoding:'utf8'}));assert.equal(inspection.validation,'passed');assert.equal(inspection.animations.length,0);
const gltf=await geometryScene(candidate);gltf.scene.updateMatrixWorld(true);const bounds=new THREE.Box3().setFromObject(gltf.scene,true),size=bounds.getSize(new THREE.Vector3());
const catalogPath=resolve(root,'assets/world-models.json'),catalog=await json(catalogPath),entry=catalog.assets.find(a=>a.key===key);assert.ok(entry,`${key} missing from assets/world-models.json`);
assert.ok(Math.abs(size.y-entry.height)<0.02,`height ${size.y} must match catalog height ${entry.height} so placement scale rules hold`);
const destination=resolve(root,'public/models',key);await mkdir(destination,{recursive:true});await mkdir(resolve(model,'geometry'),{recursive:true});
await copyFile(candidate,resolve(destination,'model.glb'));await copyFile(candidate,resolve(model,`geometry/accepted-rev${revision}.glb`));
assert.equal(sha(await readFile(resolve(destination,'model.glb'))),hash);
const reference=resolve(model,'source/original',review.referenceImage);
const manifest={modelKey:key,name:entry.name,kind:entry.kind,candidate:1,status:'reviewed-prototype',url:`/models/${key}/model.glb`,sha256:hash,bytes:bytes.length,triangles:inspection.triangles,upAxis:'Y',forwardAxis:'+Z',heightMetres:size.y,widthMetres:Math.max(size.x,size.z),
  placement:{pivot:'ground-centred',min:bounds.min.toArray(),max:bounds.max.toArray()},clips:[],notes:review.notes,lods:[],
  provenance:{provider:review.provider,claudeUsed:review.claudeUsed,referenceGenerator:review.referenceGenerator,referenceImage:portable(reference),referenceSha256:sha(await readFile(reference)),reconstruction:review.reconstruction,candidateFile:portable(candidate),visualReview:portable(resolve(model,`qa/adoption-review-rev${revision}.json`))}};
for(const name of review.acceptedLods??[]){
  const source=resolve(folder,`${name}.glb`),data=await readFile(source),check=JSON.parse(execFileSync(process.execPath,[resolve(root,'scripts/inspect-glb.mjs'),source],{encoding:'utf8'}));assert.equal(check.validation,'passed');
  await copyFile(source,resolve(destination,`${name}.glb`));manifest.lods.push({url:`/models/${key}/${name}.glb`,sha256:sha(data),bytes:data.length,triangles:check.triangles});
}
Object.assign(entry,{sha256:hash,status:'integrated-reviewed-prototype',subject:review.subject??entry.subject});
await save(resolve(destination,'asset.json'),manifest);await save(catalogPath,catalog);
const worldPath=resolve(root,'public/models/world-assets.json'),world=await json(worldPath);
if(world.assets.some(a=>a.modelKey===key))world.assets=world.assets.map(a=>a.modelKey===key?manifest:a);else world.assets.push(manifest);
await save(worldPath,world);
await save(resolve(model,'qa/delivery-inspection.json'),inspection);await save(resolve(model,'qa/delivery-manifest.json'),manifest);
console.log(JSON.stringify({key,revision,sha256:hash,bytes:bytes.length,triangles:inspection.triangles,height:size.y,width:manifest.widthMetres,lods:manifest.lods},null,2));
