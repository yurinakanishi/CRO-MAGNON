import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {resolve,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {geometryScene} from './measure-collision-bounds.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const key='floppy-ear-mage', model=resolve(root,'output/model-generation/models',key,'work/candidate-02');
const json=async path=>JSON.parse(await readFile(path,'utf8'));
const save=(path,data)=>writeFile(path,JSON.stringify(data,null,2)+'\n');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const portable=path=>relative(root,path).replaceAll('\\','/');
const review=await json(resolve(model,'qa/adoption-review.json'));
assert.equal(review.decision,'adopt');
assert.equal(review.visualGate,'passed');
assert.equal(review.browserGate,'passed');
assert.match(review.referenceImage, /^source\/original\/reference-v[12]\.png$/);
assert.ok(typeof review.subject==='string' && review.subject.length>20);
const reference=resolve(model,review.referenceImage);
const referenceBytes=await readFile(reference);
const portrait=resolve(model,review.portraitRender);
assert.ok(relative(model,portrait).startsWith('work'));
await readFile(portrait);
const candidate=resolve(model,review.candidateFile);
assert.ok(relative(model,candidate).startsWith('work'));
const bytes=await readFile(candidate),hash=sha(bytes);
assert.equal(hash,review.sha256);
const numeric=await json(resolve(candidate,'../qa/numeric.json'));
assert.equal(numeric.sha256,hash);assert.equal(numeric.numericPass,true);
const process=await json(resolve(candidate,'../process.json'));
const inspection=JSON.parse(execFileSync(globalThis.process.execPath,[resolve(root,'scripts/inspect-glb.mjs'),candidate,'--humanoid','--hunting'],{encoding:'utf8'}));
assert.equal(inspection.validation,'passed');assert.equal(inspection.animations.length,9);
const gltf=await geometryScene(candidate);gltf.scene.updateMatrixWorld(true);
const box=new THREE.Box3().setFromObject(gltf.scene,true),size=box.getSize(new THREE.Vector3());
assert.ok(Math.abs(size.y-.78)<.006);assert.ok(Math.abs(box.min.y)<.006);
for(const name of ['Walk_Loop','Run_Loop']) assert.ok(process.locomotion[name].metresPerSecond>0);
const destination=resolve(root,'public/models',key);
await mkdir(destination,{recursive:true});await mkdir(resolve(model,'geometry'),{recursive:true});
async function copyExclusive(from,to){
  try {await copyFile(from,to,constants.COPYFILE_EXCL);} catch(error){if(error.code!=='EEXIST')throw error;}
  assert.equal(sha(await readFile(from)),sha(await readFile(to)));
}
const previous=await json(resolve(destination,'asset.json'));
assert.equal(previous.sha256,'60a247305f0b698654a9e61fd991470535128362e94be5d2b047be592e46e1ef');
const previousDir=resolve(model,'work/previous-delivery');await mkdir(previousDir,{recursive:true});
for(const name of ['model.glb','asset.json','portrait.png'])await copyExclusive(resolve(destination,name),resolve(previousDir,name));
await copyExclusive(resolve(root,'output/model-generation/models',key,'qa/adoption-review.json'),resolve(previousDir,'adoption-review.json'));
await copyFile(candidate,resolve(destination,'model.glb'));
await copyExclusive(candidate,resolve(model,'geometry/accepted.glb'));
await copyFile(portrait,resolve(destination,'portrait.png'));
const manifest={modelKey:key,name:'垂れ耳の魔法使い',kind:'humanoid',candidate:2,status:'reviewed-prototype',
  url:`/models/${key}/model.glb`,sha256:hash,bytes:bytes.length,triangles:inspection.triangles,upAxis:'Y',forwardAxis:'+Z',
  heightMetres:size.y,widthMetres:size.x,placement:{pivot:'ground-centred',min:box.min.toArray(),max:box.max.toArray()},
  clips:inspection.animations.map(a=>({name:a.name,seconds:a.duration,loop:a.name.endsWith('_Loop')})),lods:[],
  species:'bear',gender:'female',bones:inspection.skins[0].joints,locomotion:process.locomotion,notes:review.notes,
  provenance:{provider:'Codex',claudeUsed:false,referenceGenerator:'Built-in imagegen preparation from user image',
    originalImage:portable(resolve(model,'source/original/user-original.png')),originalSha256:sha(await readFile(resolve(model,'source/original/user-original.png'))),
    referenceImage:portable(reference),referenceSha256:sha(referenceBytes),reconstruction:'Local TRELLIS-2; preserved dense reconstruction and measured reduction.',
    candidateFile:portable(candidate),visualReview:portable(resolve(model,'qa/adoption-review.json')),replaces:'floppy-ear-mage Candidate 1',previousDeliverySha256:previous.sha256}};
await save(resolve(destination,'asset.json'),manifest);
const catalogPath=resolve(root,'assets/world-models.json'),catalog=await json(catalogPath);
const slot=catalog.assets.findIndex(a=>a.key===key);
assert.ok(slot>=0,'Replacement slot must exist; review before repeating adoption.');
catalog.assets[slot]={key,name:manifest.name,kind:'humanoid',height:size.y,geometryResolution:1024,referenceVersion:Number(review.referenceImage.match(/v(\d+)\.png$/)[1]),
  status:'adopted-awaiting-game-QA',sha256:hash,delivery:manifest.url,subject:review.subject,replaces:'floppy-ear-mage Candidate 1',previousDeliverySha256:previous.sha256};
await save(catalogPath,catalog);
await save(resolve(root,'output/model-generation/models',key,'qa/adoption-review.json'),{...review,candidate:2,candidateFile:portable(candidate),preservedPreviousReview:portable(resolve(previousDir,'adoption-review.json'))});
await save(resolve(model,'qa/delivery-inspection.json'),inspection);
await save(resolve(model,'qa/delivery-manifest.json'),manifest);
const requestPath=resolve(root,'assets/floppy-ear-mage-prehistoric-request.json'),request=await json(requestPath);
Object.assign(request,{generation:'completed',adoption:'exact-glb-reviewed-and-adopted',gameQa:'pending',sha256:hash});await save(requestPath,request);
console.log(JSON.stringify({key,sha256:hash,triangles:manifest.triangles,status:'adopted-awaiting-game-QA'}));
