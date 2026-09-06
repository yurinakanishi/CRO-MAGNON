import {readFile,writeFile,mkdir,copyFile,realpath} from 'node:fs/promises';
import {constants} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {resolve,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {geometryScene} from './measure-collision-bounds.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),key=process.argv[2];
assert.ok(['cat-kunoichi','bear-mage','kunoichi-katana'].includes(key));
const model=resolve(root,'output/model-generation/models',key),candidate=await realpath(resolve(root,process.argv[3]||'MISSING_CANDIDATE'));
const inside=relative(await realpath(model),candidate);assert.ok(inside&&!inside.startsWith('..')&&!isAbsolute(inside));
const json=async name=>JSON.parse(await readFile(name,'utf8')),save=(name,value)=>writeFile(name,JSON.stringify(value,null,2)+'\n');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),portable=file=>relative(root,file).replaceAll('\\','/');
const spec=await json(resolve(model,'request-spec.json')),review=await json(resolve(model,'qa/adoption-review.json')),processReport=await json(resolve(candidate,'../process.json'));
const bytes=await readFile(candidate),hash=sha(bytes);assert.equal(review.decision,'adopt');assert.equal(review.sha256,hash);assert.equal(review.referenceImage,'source/original/reference-v1.png');
assert.equal(review.visualGate,'passed');assert.equal(review.browserGate,'passed');
const living=spec.kind==='humanoid';
if(living){
  const numeric=await json(resolve(candidate,'../qa/numeric.json'));assert.equal(numeric.numericPass,true);assert.equal(numeric.sha256,hash);
  for(const name of ['Walk_Loop','Run_Loop'])assert.ok(review.locomotion[name].metresPerSecond>0);
}
const inspection=JSON.parse(execFileSync(process.execPath,[resolve(root,'scripts/inspect-glb.mjs'),candidate,...(living?['--humanoid','--hunting']:[])],{encoding:'utf8'}));
assert.equal(inspection.validation,'passed');assert.equal(inspection.animations.length,living?9:0);
const geometry=await geometryScene(candidate);geometry.scene.updateMatrixWorld(true);const bounds=new THREE.Box3().setFromObject(geometry.scene,true),size=bounds.getSize(new THREE.Vector3());
assert.ok(Math.abs(size.y-spec.height)<.03);if(living)assert.ok(Math.abs(bounds.min.y)<.006);
const ref=resolve(model,review.referenceImage),destination=resolve(root,'public/models',key);await mkdir(destination,{recursive:true});await mkdir(resolve(model,'geometry'),{recursive:true});
async function copyPreserving(from,to){try{await copyFile(from,to,constants.COPYFILE_EXCL);}catch(error){if(error.code!=='EEXIST')throw error;}assert.equal(sha(await readFile(to)),sha(await readFile(from)));}
await copyPreserving(candidate,resolve(destination,'model.glb'));await copyPreserving(candidate,resolve(model,'geometry/accepted.glb'));
if(living)await copyPreserving(resolve(model,review.portraitRender),resolve(destination,'portrait.png'));
const manifest={modelKey:key,name:spec.name,kind:spec.kind,candidate:1,status:'reviewed-prototype',url:`/models/${key}/model.glb`,sha256:hash,bytes:bytes.length,triangles:inspection.triangles,upAxis:'Y',forwardAxis:'+Z',heightMetres:size.y,widthMetres:size.x,
  placement:living?{pivot:'ground-centred',min:bounds.min.toArray(),max:bounds.max.toArray()}:processReport.placement,
  clips:inspection.animations.map(a=>({name:a.name,seconds:a.duration,loop:a.name.endsWith('_Loop')})),lods:[],notes:review.notes,
  provenance:{provider:'Codex',claudeUsed:false,referenceGenerator:'Built-in imagegen',referenceImage:portable(ref),referenceSha256:sha(await readFile(ref)),reconstruction:'Local TRELLIS-2; preserved dense reconstruction and measured reduction.',candidateFile:portable(candidate),visualReview:portable(resolve(model,'qa/adoption-review.json'))}};
if(living)Object.assign(manifest,{species:key==='bear-mage'?'bear':'cat',gender:'female',bones:inspection.skins[0].joints,locomotion:review.locomotion});else manifest.onDemand=true;
const catalogPath=resolve(root,'assets/world-models.json'),catalog=await json(catalogPath),old=catalog.assets.find(a=>a.key===key);
if(old)assert.equal(old.sha256,hash);else catalog.assets.push({key,name:spec.name,kind:spec.kind,height:size.y,geometryResolution:spec.geometryResolution,referenceVersion:1,status:'adopted-awaiting-game-QA',sha256:hash,delivery:manifest.url,subject:key==='cat-kunoichi'?'Adult female cat-eared kunoichi in a covered primitive dark outfit.':key==='bear-mage'?'Original tiny round bear mage in a moss-green woven capelet and waistwrap.':'Single curved katana with wrapped indigo grip, dark guard and silver blade.'});
await save(resolve(destination,'asset.json'),manifest);await save(catalogPath,catalog);
if(!living){const worldPath=resolve(root,'public/models/world-assets.json'),world=await json(worldPath);world.assets=world.assets.filter(a=>a.modelKey!==key);world.assets.push(manifest);await save(worldPath,world);}
await save(resolve(model,'qa/delivery-inspection.json'),inspection);await save(resolve(model,'qa/delivery-manifest.json'),manifest);
const requestPath=resolve(root,'assets/fantasy-playables-request.json'),request=await json(requestPath);Object.assign(request.models.find(a=>a.key===key),{generation:'completed',adoption:'exact-glb-reviewed-and-adopted',gameQa:'pending',sha256:hash});await save(requestPath,request);
console.log(JSON.stringify({key,sha256:hash,bytes:bytes.length,triangles:manifest.triangles,bounds:manifest.placement,status:'adopted-awaiting-game-QA'},null,2));
