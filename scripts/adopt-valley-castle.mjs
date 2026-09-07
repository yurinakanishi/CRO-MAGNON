import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const key='valley-castle',root=`output/model-generation/models/${key}`,candidate=`${root}/work/low-poly/candidate-06/candidate.glb`;
const json=async p=>JSON.parse(await readFile(p,'utf8')),save=(p,v)=>writeFile(p,JSON.stringify(v,null,2)+'\n'),sha=b=>createHash('sha256').update(b).digest('hex');
const bytes=await readFile(candidate),hash=sha(bytes),review=await json(`${root}/qa/adoption-review.json`),inspection=await json(`${root}/qa/revision-06-inspection.json`);
assert.equal(review.decision,'adopt');assert.equal(review.sha256,hash);assert.equal(inspection.validation,'passed');assert.equal(inspection.sha256,hash);
const reference=`${root}/source/original/reference-v2.png`,destination=`public/models/${key}`;
await mkdir(destination,{recursive:true});await mkdir(`${root}/geometry`,{recursive:true});
for(const to of [`${destination}/model.glb`,`${root}/geometry/accepted.glb`]){try{await copyFile(candidate,to,constants.COPYFILE_EXCL);}catch(e){if(e.code!=='EEXIST')throw e;}assert.equal(sha(await readFile(to)),hash);}
const manifest={modelKey:key,name:'白羽の大城',kind:'static',candidate:1,status:'reviewed-prototype',environment:true,onDemand:true,url:`/models/${key}/model.glb`,sha256:hash,bytes:bytes.length,triangles:inspection.triangles,upAxis:'Y',forwardAxis:'+Z',heightMetres:26.07665,widthMetres:69.99084,
  placement:{pivot:'ground-centred',min:[-35.000622,-.18375,-32.494679],max:[34.990219,25.892897,33]},clips:[],lods:[],
  notes:'Three exposed terrace levels, paired stone staircases, source-derived entrance stair and upper hall doorway. No tower climbing or hidden intermediate rooms. Full mesh shared; unrepaired coarse LODs are not adopted.',
  provenance:{provider:'Codex',claudeUsed:false,referenceGenerator:'Built-in imagegen',referenceImage:reference,referenceSha256:sha(await readFile(reference)),reconstruction:'Local TRELLIS-2 1024; shape-preserving reduction, source-triangle door clipping and reuse of the existing stair and floor; lossless buffer packing.',candidateFile:candidate,visualReview:`${root}/qa/adoption-review.json`}};
await save(`${destination}/asset.json`,manifest);
const catalog=await json('assets/world-models.json');catalog.assets=catalog.assets.filter(a=>a.key!==key);catalog.assets.push({key,name:manifest.name,kind:'static',height:manifest.heightMetres,geometryResolution:1024,referenceVersion:2,status:'adopted-awaiting-game-QA',sha256:hash,delivery:manifest.url,subject:manifest.notes});await save('assets/world-models.json',catalog);
const world=await json('public/models/world-assets.json');world.assets=world.assets.filter(a=>a.modelKey!==key);world.assets.push(manifest);await save('public/models/world-assets.json',world);
await save(`${root}/qa/delivery-manifest.json`,manifest);await save(`${root}/qa/delivery-inspection.json`,inspection);
const request=await json('assets/valley-castle-request.json');Object.assign(request,{generation:'completed',adoption:'exact-glb-reviewed-and-adopted',integration:'implemented-awaiting-game-QA',gameQA:'pending',revision:'06',sha256:hash});request.history[1].status='reconstructed-and-preserved';await save('assets/valley-castle-request.json',request);
console.log(JSON.stringify({key,sha256:hash,bytes:bytes.length,triangles:inspection.triangles}));
