import {readFile,writeFile,mkdir,copyFile,realpath} from 'node:fs/promises';
import {constants} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {resolve,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {geometryScene} from './measure-collision-bounds.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),key=process.argv[2],revision=process.argv[3];
assert.ok(['desert-cactus','volcanic-basalt-columns'].includes(key));assert.match(revision,/^\d{2}$/);
const model=resolve(root,'output/model-generation/models',key),folder=await realpath(resolve(model,'work/low-poly',`candidate-${revision}`)),candidate=resolve(folder,'candidate.glb');
const inside=relative(await realpath(model),folder);assert.ok(inside&&!inside.startsWith('..')&&!isAbsolute(inside));
const json=async name=>JSON.parse(await readFile(name,'utf8')),save=(name,value)=>writeFile(name,JSON.stringify(value,null,2)+'\n'),sha=bytes=>createHash('sha256').update(bytes).digest('hex'),portable=file=>relative(root,file).replaceAll('\\','/');
const spec=await json(resolve(model,'request-spec.json')),review=await json(resolve(model,'qa/adoption-review.json')),processReport=await json(resolve(folder,'process-report.json'));
const bytes=await readFile(candidate),hash=sha(bytes);assert.equal(review.decision,'adopt');assert.equal(review.sha256,hash);assert.equal(review.visualGate,'passed');assert.equal(review.browserGate,'passed');
const inspection=JSON.parse(execFileSync(process.execPath,[resolve(root,'scripts/inspect-glb.mjs'),candidate],{encoding:'utf8'}));assert.equal(inspection.validation,'passed');assert.equal(inspection.animations.length,0);
const gltf=await geometryScene(candidate);gltf.scene.updateMatrixWorld(true);const bounds=new THREE.Box3().setFromObject(gltf.scene,true),size=bounds.getSize(new THREE.Vector3());
const destination=resolve(root,'public/models',key);await mkdir(destination,{recursive:true});await mkdir(resolve(model,'geometry'),{recursive:true});
async function preserve(from,to){try{await copyFile(from,to,constants.COPYFILE_EXCL);}catch(error){if(error.code!=='EEXIST')throw error;}assert.equal(sha(await readFile(to)),sha(await readFile(from)));}
await preserve(candidate,resolve(destination,'model.glb'));await preserve(candidate,resolve(model,'geometry/accepted.glb'));
const reference=resolve(model,'source/original/reference-v1.png');
const footprint=await json(resolve(model,`qa/footprint-rev${revision}.json`));assert.equal(footprint.sha256,hash);assert.equal(footprint.verification.misses,0);
const manifest={modelKey:key,name:spec.name,kind:spec.kind,candidate:1,status:'reviewed-prototype',environment:true,onDemand:true,url:`/models/${key}/model.glb`,sha256:hash,bytes:bytes.length,triangles:inspection.triangles,upAxis:'Y',forwardAxis:'+Z',heightMetres:size.y,widthMetres:size.x,
  placement:spec.kind==='terrain'?processReport.placement:{pivot:'ground-centred',min:bounds.min.toArray(),max:bounds.max.toArray()},clips:[],lods:[],notes:review.notes,
  provenance:{provider:'Codex',claudeUsed:false,referenceGenerator:'Built-in imagegen',referenceImage:portable(reference),referenceSha256:sha(await readFile(reference)),reconstruction:'Local TRELLIS-2; preserved dense reconstruction, source-derived reduction and separate revisions.',candidateFile:portable(candidate),visualReview:portable(resolve(model,'qa/adoption-review.json'))}};
if(spec.kind==='terrain'){assert.equal(processReport.sampling.missingSamples,0);assert.ok(processReport.sampling.maximumEdgeHeightMetres<.005);assert.ok(manifest.placement.heightField.heights.every(Number.isFinite));}
for(const name of review.acceptedLods??['lod1','lod2']){
  const source=resolve(folder,`${name}.glb`),data=await readFile(source),check=JSON.parse(execFileSync(process.execPath,[resolve(root,'scripts/inspect-glb.mjs'),source],{encoding:'utf8'}));assert.equal(check.validation,'passed');
  await preserve(source,resolve(destination,`${name}.glb`));manifest.lods.push({url:`/models/${key}/${name}.glb`,sha256:sha(data),bytes:data.length,triangles:check.triangles});
}
const catalogPath=resolve(root,'assets/world-models.json'),catalog=await json(catalogPath),old=catalog.assets.find(a=>a.key===key);
if(old)assert.equal(old.sha256,hash);else catalog.assets.push({key,name:spec.name,kind:spec.kind,height:size.y,geometryResolution:spec.geometryResolution,referenceVersion:1,status:'adopted-awaiting-game-QA',sha256:hash,delivery:manifest.url,subject:spec.subject??spec.prompt});
await save(resolve(destination,'asset.json'),manifest);await save(catalogPath,catalog);
const worldPath=resolve(root,'public/models/world-assets.json'),world=await json(worldPath);world.assets=world.assets.filter(a=>a.modelKey!==key);world.assets.push(manifest);await save(worldPath,world);
await save(resolve(model,'qa/delivery-inspection.json'),inspection);await save(resolve(model,'qa/delivery-manifest.json'),manifest);
const requestPath=resolve(root,'assets/region-specific-request.json'),request=await json(requestPath);Object.assign(request.models.find(a=>a.key===key),{generation:'completed',adoption:'exact-glb-reviewed-and-adopted',gameQA:'pending',revision,sha256:hash});await save(requestPath,request);
console.log(JSON.stringify({key,revision,sha256:hash,bytes:bytes.length,triangles:inspection.triangles,lods:manifest.lods},null,2));
